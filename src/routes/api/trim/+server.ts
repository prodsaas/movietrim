import { json } from '@sveltejs/kit';
import { promisify } from 'util';
import { exec, spawn } from 'child_process';
import path from 'path';
import { stat, readFile, writeFile, unlink } from 'fs/promises';
import { pipeline } from 'stream/promises';
import { createWriteStream } from 'fs';
import { Readable } from 'stream';
import type { ReadableStream } from 'stream/web';
import { jobProgress } from '$lib/server/progress';
import type { RequestHandler } from './$types';

const execPromise = promisify(exec);
let cachedEncoder: string | null = null;

function runFFmpeg(args: string[], jobId: string, duration: number, status: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const ffmpegProcess = spawn('ffmpeg', args);

        ffmpegProcess.stdout.resume();

        let errorLogWindow = '';
        let regexBuffer = '';

        ffmpegProcess.stderr.on('data', (data: Buffer) => {
            const chunk = data.toString();
            errorLogWindow = (errorLogWindow + chunk).slice(-1000);
            regexBuffer = (regexBuffer + chunk).slice(-512);

            const matches = [...regexBuffer.matchAll(/time=\s*-?(\d+):(\d{2}):([\d.]+)/g)];
            if (matches.length > 0) {
                const [, h, m, s] = matches[matches.length - 1];
                const currentSeconds = (parseInt(h, 10) * 3600) + (parseInt(m, 10) * 60) + parseFloat(s);
                const percent = Math.min(99, Math.round((currentSeconds / duration) * 100));
                jobProgress.set(jobId, { percent, status });
            }
        });

        ffmpegProcess.on('error', (error: Error) => reject(new Error(`FFmpeg spawn failed: ${error.message}`)));
        ffmpegProcess.on('close', (code: number | null) => {
            if (code === 0) resolve();
            else reject(new Error(`FFmpeg crashed (Code ${code}): ${errorLogWindow}`));
        });
    });
}

async function getEncoder(): Promise<string> {
    if (cachedEncoder) return cachedEncoder;
    try {
        const { stdout } = await execPromise('ffmpeg -encoders');
        cachedEncoder = stdout.includes('libopenh264') ? 'libopenh264' : 'libx264';
    }
    catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.warn('[Trim API] Failed to fetch encoders:', msg);
        cachedEncoder = 'libx264';
    }
    return cachedEncoder;
}

function parseTimeToSeconds(timeStr: string): number {
    const parts = timeStr.split(':').map(Number);
    if (parts.length === 3) return (parts[0] * 3600) + (parts[1] * 60) + parts[2];
    if (parts.length === 2) return (parts[0] * 60) + parts[1];
    return parts[0] || 0;
}

export const POST: RequestHandler = async ({ request }) => {
    try {
        const formData = await request.formData();

        const jobId = formData.get('jobId') as string;
        const startTime = formData.get('startTime') as string;
        const duration = Number(formData.get('duration'));
        const audioIndex = Number(formData.get('audioIndex'));
        const subtitleIndex = Number(formData.get('subtitleIndex'));

        const customAudioFile = formData.get('customAudio') as File | null;
        const customSubtitleFile = formData.get('customSubtitle') as File | null;

        const timeRegex = /^\d+:[0-5]\d:[0-5]\d$/;
        if (!startTime || !timeRegex.test(startTime)) return json({ error: 'Invalid Start Time format.' }, { status: 400 });
        if (isNaN(duration) || duration <= 0) return json({ error: 'Invalid duration.' }, { status: 400 });
        if (!jobId) return json({ error: 'Missing Job ID.' }, { status: 400 });

        const ext = path.extname(jobId);
        const baseId = path.basename(jobId, ext);
        const uploadDir = path.resolve('./upload');
        const inputPath = path.join(uploadDir, `${baseId}_input${ext}`);

        let audioPath = '';
        let subtitlePath = '';

        try {
            await stat(inputPath);
        } catch {
            return json({ error: 'Source video not found. It may have been cleaned up.' }, { status: 404 });
        }

        if (customAudioFile && customAudioFile.size > 0) {
            audioPath = path.join(uploadDir, `${baseId}_custom_audio${path.extname(customAudioFile.name) || '.mp3'}`);
            await pipeline(Readable.fromWeb(customAudioFile.stream() as unknown as ReadableStream<Uint8Array>), createWriteStream(audioPath));
        }

        if (customSubtitleFile && customSubtitleFile.size > 0) {
            subtitlePath = path.join(uploadDir, `${baseId}_custom_subs${path.extname(customSubtitleFile.name) || '.srt'}`);
            await pipeline(Readable.fromWeb(customSubtitleFile.stream() as unknown as ReadableStream<Uint8Array>), createWriteStream(subtitlePath));
        }
        else {
            subtitlePath = path.join(uploadDir, `${baseId}_subs.srt`);
        }

        const burnSubtitles = subtitleIndex !== -1;
        const outputExt = burnSubtitles ? '.mp4' : ext;
        const outputPath = path.join(uploadDir, `${baseId}_output${outputExt}`);

        let message = 'Processing video...';
        if (burnSubtitles && audioIndex !== -1) message = 'Adding audio and subtitle to video...';
        else if (burnSubtitles && audioIndex === -1) message = 'Adding subtitle to video...';
        else if (!burnSubtitles && audioIndex !== -1) message = 'Adding audio to video...';
        else if (!burnSubtitles && audioIndex === -1) message = 'Removing audio from video...';

        jobProgress.set(jobId, { percent: 0, status: 'Initiating...' });

        (async () => {
            try {
                if (burnSubtitles) {
                    if (subtitleIndex !== -2) {
                        const extractArgs = ['-y', '-i', inputPath, '-map', `0:${subtitleIndex}`, '-c:s', 'srt', subtitlePath];
                        await runFFmpeg(extractArgs, jobId, duration, 'Extracting subtitle track...');

                        try {
                            const srtContent = await readFile(subtitlePath, 'utf8');
                            await writeFile(subtitlePath, srtContent.replace(/<[^>]+>/g, ''), 'utf8');
                        }
                        catch (err: unknown) {
                            console.warn('[Trim API] SRT sanitization failed:', err instanceof Error ? err.message : String(err));
                        }
                    }

                    const videoEncoder = await getEncoder();
                    const startSecs = parseTimeToSeconds(startTime);
                    const safeSrt = subtitlePath.replace(/\\/g, '/').replace(/:/g, '\\:');

                    const burnArgs = ['-y', '-ss', startTime, '-i', inputPath];
                    if (audioPath) burnArgs.push('-i', audioPath);

                    burnArgs.push('-t', String(duration), '-map', '0:v:0');

                    if (audioIndex === -2 && audioPath) burnArgs.push('-map', '1:a:0');
                    else if (audioIndex !== -1) burnArgs.push('-map', `0:${audioIndex}`);

                    burnArgs.push(
                        '-vf', `setpts=PTS+${startSecs}/TB,subtitles='${safeSrt}',setpts=PTS-${startSecs}/TB`,
                        '-c:v', videoEncoder,
                        '-profile:v', 'high', '-b:v', '6M', '-maxrate', '8M', '-bufsize', '16M', '-pix_fmt', 'yuv420p',
                        '-c:a', (audioIndex === -2) ? 'aac' : 'copy',
                        '-sn', outputPath
                    );

                    await runFFmpeg(burnArgs, jobId, duration, message);
                }
                else {
                    const copyArgs = ['-y', '-ss', startTime, '-i', inputPath];
                    if (audioPath) copyArgs.push('-i', audioPath);

                    copyArgs.push('-t', String(duration), '-map', '0:v:0');

                    if (audioIndex === -2 && audioPath) {
                        copyArgs.push('-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-sn', outputPath);
                    }
                    else {
                        if (audioIndex !== -1) copyArgs.push('-map', `0:${audioIndex}`);
                        copyArgs.push('-c', 'copy', '-sn', outputPath);
                    }

                    await runFFmpeg(copyArgs, jobId, duration, message);
                }

                jobProgress.set(jobId, { percent: 100, status: 'Completed', downloadUrl: `/api/download/${baseId}_output${outputExt}` });
            }
            catch (error: unknown) {
                const msg = error instanceof Error ? error.message : String(error);
                console.error('[Trim API Background] Error:', msg);
                jobProgress.set(jobId, { percent: -1, status: `Error: ${msg}` });
            }
            finally {
                const filesToClean = [inputPath, audioPath, subtitlePath].filter(Boolean);
                await Promise.allSettled(filesToClean.map(f => unlink(f).catch(() => { })));
            }
        })();

        return json({ success: true, message: 'Processing started' });
    }
    catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('[Trim API] Error:', msg);
        return json({ error: 'Failed to initialize processing' }, { status: 500 });
    }
};