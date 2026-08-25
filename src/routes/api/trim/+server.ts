import { json } from '@sveltejs/kit';
import { promisify } from 'util';
import { exec, spawn } from 'child_process';
import path from 'path';
import { stat, readFile, writeFile, unlink } from 'fs/promises';
import { jobProgress } from '$lib/server/progress';
import type { RequestHandler } from './$types';

const execPromise = promisify(exec);
let cachedEncoder: string | null = null;

function runFFmpeg(args: string[], jobId: string, duration: number, status: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const ffmpegProcess = spawn('ffmpeg', args);

        let errorLogWindow = '';
        let regexBuffer = '';

        ffmpegProcess.stderr.on('data', (data) => {
            const chunk = data.toString();

            errorLogWindow += chunk;
            if (errorLogWindow.length > 1000) {
                errorLogWindow = errorLogWindow.slice(-1000);
            }

            regexBuffer += chunk;
            if (regexBuffer.length > 512) {
                regexBuffer = regexBuffer.slice(-512);
            }

            const matches = [...regexBuffer.matchAll(/time=\s*-?(\d+):(\d{2}):([\d.]+)/g)];

            if (matches.length > 0) {
                const lastMatch = matches[matches.length - 1];
                const hours = parseInt(lastMatch[1], 10);
                const minutes = parseInt(lastMatch[2], 10);
                const seconds = parseFloat(lastMatch[3]);
                const currentSeconds = (hours * 3600) + (minutes * 60) + seconds;

                const percent = Math.min(99, Math.round((currentSeconds / duration) * 100));
                jobProgress.set(jobId, { percent, status });
            }
        });

        ffmpegProcess.on('error', (error) => {
            reject(new Error(`Failed to start FFmpeg process: ${error.message}`));
        });

        ffmpegProcess.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`FFmpeg crashed with code ${code}. Log: ${errorLogWindow}`));
        });
    });
}

async function getEncoder(): Promise<string> {
    if (cachedEncoder) return cachedEncoder;

    try {
        const { stdout } = await execPromise('ffmpeg -encoders');
        if (stdout.includes('libopenh264')) cachedEncoder = 'libopenh264';
        else if (stdout.includes('libx264')) cachedEncoder = 'libx264';
        else cachedEncoder = 'libx264';
    }
    catch (error: unknown) {
        console.warn('[Trim API] Failed to probe encoders:', (error as Error).message);
        cachedEncoder = 'libx264';
    }
    return cachedEncoder;
}

export const POST: RequestHandler = async ({ request }) => {
    let jobId = '';
    let inputPath = '';
    let audioPath = '';
    let subtitlePath = '';

    try {
        const formData = await request.formData();
        jobId = formData.get('jobId') as string;

        const ext = path.extname(jobId);
        const baseId = path.basename(jobId, ext);

        const startTime = formData.get('startTime') as string;
        const duration = Number(formData.get('duration'));
        const audioIndex = Number(formData.get('audioIndex'));
        const subtitleIndex = Number(formData.get('subtitleIndex'));

        const timeRegex = /^\d+:[0-5]\d:[0-5]\d$/;
        if (!startTime || !timeRegex.test(startTime)) {
            return json({ error: 'Invalid Start Time format. Must be HH:MM:SS with valid minutes and seconds.' }, { status: 400 });
        }
        if (isNaN(duration) || duration <= 0) {
            return json({ error: 'Invalid trim duration.' }, { status: 400 });
        }

        const customAudioFile = formData.get('customAudio') as File | null;
        const customSubtitleFile = formData.get('customSubtitle') as File | null;

        if (customAudioFile && customAudioFile.size > 0) {
            const audioExt = path.extname(customAudioFile.name).toLowerCase();
            const validAudioExts = ['.mp3', '.wav', '.aac', '.m4a', '.ogg', '.flac'];
            if (!customAudioFile.type.startsWith('audio/') && !validAudioExts.includes(audioExt)) {
                return json({ error: 'Invalid custom audio file type rejected by server.' }, { status: 400 });
            }
        }

        if (customSubtitleFile && customSubtitleFile.size > 0) {
            const subExt = path.extname(customSubtitleFile.name).toLowerCase();
            const validSubExts = ['.srt', '.vtt', '.ass'];
            if (!validSubExts.includes(subExt)) {
                return json({ error: 'Invalid subtitle file type rejected by server. Must be .srt, .vtt, or .ass.' }, { status: 400 });
            }
        }

        const uploadDir = path.resolve('./upload');
        inputPath = path.join(uploadDir, `${baseId}_input${ext}`);

        if (customAudioFile && customAudioFile.size > 0) {
            audioPath = path.join(uploadDir, `${baseId}_custom_audio${path.extname(customAudioFile.name) || '.mp3'}`);
            await writeFile(audioPath, Buffer.from(await customAudioFile.arrayBuffer()));
        }

        if (customSubtitleFile && customSubtitleFile.size > 0) {
            subtitlePath = path.join(uploadDir, `${baseId}_custom_subs${path.extname(customSubtitleFile.name) || '.srt'}`);
            await writeFile(subtitlePath, Buffer.from(await customSubtitleFile.arrayBuffer()));
        }
        else {
            subtitlePath = path.join(uploadDir, `${baseId}_subs.srt`);
        }

        const burnSubtitles = subtitleIndex !== -1;
        const outputExt = burnSubtitles ? '.mp4' : ext;
        const outputPath = path.join(uploadDir, `${baseId}_output${outputExt}`);

        try {
            await stat(inputPath);
        }
        catch (error: unknown) {
            console.warn(`[Trim API] Source stat error for ${inputPath}:`, (error as Error).message);
            return json({ error: 'Source file not found or already deleted' }, { status: 404 });
        }

        let message = 'Processing video';
        if (burnSubtitles && audioIndex !== -1) message = 'Adding audio and subtitle to video';
        else if (burnSubtitles && audioIndex === -1) message = 'Adding subtitle to video';
        else if (!burnSubtitles && audioIndex !== -1) message = 'Adding audio to video';
        else if (!burnSubtitles && audioIndex === -1) message = 'Removing audio from video';

        if (burnSubtitles) {
            if (subtitleIndex !== -2) {
                const extractArgs = [
                    '-y', '-i', inputPath,
                    '-map', `0:${subtitleIndex}`,
                    '-c:s', 'srt', subtitlePath
                ];
                await runFFmpeg(extractArgs, jobId, duration, 'Extracting subtitle');

                try {
                    const srtContent = await readFile(subtitlePath, 'utf8');
                    await writeFile(subtitlePath, srtContent.replace(/<[^>]+>/g, ''), 'utf8');
                }
                catch (error: unknown) {
                    console.warn('[Trim API] Failed to sanitize SRT file:', (error as Error).message);
                }
            }

            let startSecs = 0;
            const timeParts = startTime.split(':').map(Number);
            if (timeParts.length === 3) startSecs = (timeParts[0] * 3600) + (timeParts[1] * 60) + timeParts[2];
            else if (timeParts.length === 2) startSecs = (timeParts[0] * 60) + timeParts[1];
            else startSecs = timeParts[0] || 0;

            const videoEncoder = await getEncoder();
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

        return json({ success: true, downloadUrl: `/api/download/${baseId}_output${outputExt}` });
    }
    catch (error) {
        console.error('[Trim API] Processing Error:', error);
        const errorMessage = error instanceof Error ? error.message : 'Processing failed';
        return json({ error: errorMessage }, { status: 500 });
    }
    finally {
        const filesToClean = [inputPath, audioPath, subtitlePath].filter(Boolean);
        await Promise.allSettled(
            filesToClean.map(f => unlink(f).catch((error: NodeJS.ErrnoException) => {
                if (error.code !== 'ENOENT') console.warn(`[Trim API] Cleanup warning for ${f}:`, error.message);
            }))
        );
        if (jobId) jobProgress.delete(jobId);
    }
};