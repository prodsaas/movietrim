import { promisify } from 'util';
import { exec } from 'child_process';
import type { PageServerLoad } from './$types';

const execPromise = promisify(exec);
let hasFFmpegCache: boolean | null = null;

export const load: PageServerLoad = async () => {
    if (hasFFmpegCache !== null) {
        return { hasFFmpeg: hasFFmpegCache };
    }

    try {
        await execPromise('ffmpeg -version');
        hasFFmpegCache = true;
    }
    catch (error) {
        console.error('[Startup Error] FFmpeg is not installed:', error);
        hasFFmpegCache = false;
    }

    return { hasFFmpeg: hasFFmpegCache };
};