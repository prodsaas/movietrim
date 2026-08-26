import { json } from '@sveltejs/kit';
import { promisify } from 'util';
import { execFile } from 'child_process';
import path from 'path';
import { createWriteStream } from 'fs';
import { readdir, stat, unlink, mkdir } from 'fs/promises';
import { randomUUID } from 'crypto';
import createBusboy from 'busboy';
import type { RequestHandler } from './$types';

interface FFprobeStream {
    index: number;
    codec_type: string;
    tags?: {
        language?: string;
        title?: string;
    };
    disposition?: {
        default?: number;
    };
}

export interface Track {
    index: number;
    title: string;
    isDefault?: boolean;
}

const execFilePromise = promisify(execFile);

async function deleteOldFiles() {
    const uploadDir = path.resolve('./upload');
    try {
        const files = await readdir(uploadDir).catch(() => []);
        const twoHoursAgo = Date.now() - (2 * 60 * 60 * 1000);

        for (const file of files) {
            if (file.startsWith('.')) continue;
            const filePath = path.join(uploadDir, file);
            const fileStat = await stat(filePath).catch(() => null);

            if (fileStat && fileStat.mtimeMs < twoHoursAgo) {
                await unlink(filePath).catch(() => { });
            }
        }
    }
    catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('[Upload API] Delete Error:', msg);
    }
}

function formatTrackTitle(stream: FFprobeStream, defaultFallback: string) {
    const lang = stream.tags?.language;
    const title = stream.tags?.title;
    if (lang && title) return `${lang} - ${title}`;
    if (lang) return lang;
    if (title) return title;
    return defaultFallback;
}

export const POST: RequestHandler = async ({ request }) => {
    const contentType = request.headers.get('content-type') || '';
    if (!contentType.includes('multipart/form-data')) return json({ error: 'Invalid content type' }, { status: 400 });

    const uploadDir = path.resolve('./upload');
    await mkdir(uploadDir, { recursive: true }).catch(() => { });

    let baseId: string = randomUUID();
    let jobId = '';
    let inputPath = '';
    let chunkIndex = 0;
    let totalChunks = 1;
    let providedJobId = '';
    let originalFilename = '';

    try {
        await new Promise<void>((resolve, reject) => {
            const busboy = createBusboy({ headers: { 'content-type': contentType } });
            const fileWritePromises: Promise<void>[] = [];

            busboy.on('field', (name, val) => {
                if (name === 'filename') originalFilename = val.toLowerCase();
                if (name === 'chunkIndex') chunkIndex = parseInt(val, 10);
                if (name === 'totalChunks') totalChunks = parseInt(val, 10);
                if (name === 'jobId') providedJobId = val;
            });

            busboy.on('file', (fieldname, file, info) => {
                const finalFilename = originalFilename || info.filename.toLowerCase();
                const isValidExt = ['.mp4', '.mkv', '.avi', '.mov', '.webm'].some(ext => finalFilename.endsWith(ext));

                if (!isValidExt) {
                    file.resume();
                    return reject(new Error('INVALID_FILE_TYPE'));
                }

                const ext = path.extname(finalFilename) || '.mp4';

                if (chunkIndex === 0) {
                    jobId = `${baseId}${ext}`;
                    inputPath = path.join(uploadDir, `${baseId}_input${ext}`);
                    deleteOldFiles();
                }
                else {
                    jobId = providedJobId;
                    baseId = path.basename(jobId, ext);
                    inputPath = path.join(uploadDir, `${baseId}_input${ext}`);
                }

                const writeStream = createWriteStream(inputPath, { flags: chunkIndex === 0 ? 'w' : 'a' });

                fileWritePromises.push(new Promise((res, rej) => {
                    writeStream.on('close', res);
                    writeStream.on('error', rej);
                }));

                writeStream.on('error', reject);
                file.pipe(writeStream);
            });

            busboy.on('finish', async () => {
                try {
                    await Promise.all(fileWritePromises);
                    resolve();
                }
                catch (err) {
                    reject(err);
                }
            });

            busboy.on('error', reject);

            if (request.body) {
                const reader = (request.body as unknown as ReadableStream<Uint8Array>).getReader();
                (async () => {
                    try {
                        while (true) {
                            const { done, value } = await reader.read();
                            if (done) {
                                busboy.end();
                                break;
                            }
                            if (value) busboy.write(value);
                        }
                    }
                    catch (err) {
                        reject(err);
                    }
                })();
            }
            else {
                reject(new Error('Empty request body'));
            }
        });

        let audios: Track[] = [];
        let subtitles: Track[] = [];

        if (chunkIndex === totalChunks - 1) {
            try {
                const { stdout } = await execFilePromise('ffprobe', [
                    '-v', 'quiet', '-print_format', 'json', '-show_streams', inputPath
                ], { maxBuffer: 100 * 1024 * 1024 });

                const metadata = JSON.parse(stdout);

                if (metadata.streams) {
                    audios = metadata.streams
                        .filter((s: FFprobeStream) => s.codec_type === 'audio')
                        .map((s: FFprobeStream) => ({
                            index: s.index,
                            title: formatTrackTitle(s, `Audio Track ${s.index}`),
                            isDefault: s.disposition?.default === 1
                        }));

                    subtitles = metadata.streams
                        .filter((s: FFprobeStream) => s.codec_type === 'subtitle')
                        .map((s: FFprobeStream) => ({
                            index: s.index,
                            title: formatTrackTitle(s, `Subtitle Track ${s.index}`)
                        }));
                }
            }
            catch (error: unknown) {
                const msg = error instanceof Error ? error.message : String(error);
                console.warn('[Upload API] FFprobe extraction warning:', msg);
            }
        }

        return json({ success: true, jobId, audios, subtitles });
    }
    catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        
        if (inputPath) unlink(inputPath).catch(() => { });

        if (msg === 'INVALID_FILE_TYPE') {
            return json({ error: 'Only video files (.mp4, .mkv, .avi, .mov, .webm) are allowed.' }, { status: 415 });
        }
        console.error('[Upload API] Upload process failed:', msg);
        return json({ error: 'Upload failed or connection aborted' }, { status: 500 });
    }
};