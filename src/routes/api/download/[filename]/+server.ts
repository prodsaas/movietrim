import path from 'path';
import { stat, unlink } from 'fs/promises';
import { createReadStream } from 'fs';
import { Readable } from 'stream';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
    const filename = path.basename(params.filename);
    const filePath = path.resolve('./upload', filename);

    try {
        const fileStat = await stat(filePath);

        const ext = path.extname(filename).toLowerCase();
        const mimeTypes: Record<string, string> = {
            '.mp4': 'video/mp4',
            '.mkv': 'video/x-matroska',
            '.avi': 'video/x-msvideo',
            '.mov': 'video/quicktime',
            '.webm': 'video/webm'
        };
        const contentType = mimeTypes[ext] || 'application/octet-stream';

        const nodeStream = createReadStream(filePath);

        let isCleanedUp = false;
        const cleanup = () => {
            if (isCleanedUp) return;
            isCleanedUp = true;

            unlink(filePath).catch((error: NodeJS.ErrnoException) => {
                if (error.code !== 'ENOENT') {
                    console.warn(`[Download API] Cleanup warning for ${filename}:`, error.message);
                }
            });
        };

        nodeStream.on('close', cleanup);
        nodeStream.on('error', cleanup);

        const webStream = Readable.toWeb(nodeStream);

        console.info('Video Processed');

        return new Response(webStream as ReadableStream, {
            headers: {
                'Content-Type': contentType,
                'Content-Length': fileStat.size.toString(),
                'Content-Disposition': `attachment; filename="trimmed_${filename}"`
            }
        });
    }
    catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return new Response('File not found', { status: 404 });
        }
        console.error('[Download API] Stream Error:', error);
        return new Response('Internal Server Error', { status: 500 });
    }
};