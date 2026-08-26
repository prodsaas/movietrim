import path from 'path';
import { stat, unlink } from 'fs/promises';
import { createReadStream } from 'fs';
import { Readable } from 'stream';
import type { RequestHandler } from './$types';

const MIME_TYPES: Record<string, string> = {
    '.mp4': 'video/mp4',
    '.mkv': 'video/x-matroska',
    '.avi': 'video/x-msvideo',
    '.mov': 'video/quicktime',
    '.webm': 'video/webm'
};

export const GET: RequestHandler = async ({ params }) => {
    const filename = path.basename(params.filename);
    const filePath = path.resolve('./upload', filename);

    try {
        const fileStat = await stat(filePath);
        const ext = path.extname(filename).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';

        const nodeStream = createReadStream(filePath);
        let isCleanedUp = false;

        const cleanup = () => {
            if (isCleanedUp) return;
            isCleanedUp = true;
            unlink(filePath).catch((err: NodeJS.ErrnoException) => {
                if (err.code !== 'ENOENT') console.warn(`[Download API] Cleanup warning for ${filename}:`, err.message);
            });
        };

        nodeStream.on('close', cleanup);
        nodeStream.on('error', cleanup);

        console.info("[Download API] Video processed");

        return new Response(Readable.toWeb(nodeStream) as ReadableStream, {
            headers: {
                'Content-Type': contentType,
                'Content-Length': fileStat.size.toString(),
                'Content-Disposition': `attachment; filename="trimmed_${filename}"`
            }
        });
    }
    catch (error: unknown) {
        const err = error as NodeJS.ErrnoException;
        if (err.code === 'ENOENT') {
            return new Response('File not found or already deleted', { status: 404 });
        }
        console.error('[Download API] Stream Error:', err.message);
        return new Response('Internal Server Error', { status: 500 });
    }
};