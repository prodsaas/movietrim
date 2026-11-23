import path from 'path';
import { readdir, unlink } from 'fs/promises';
import { jobProgress } from '#lib/server/progress.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
    try {
        let jobId = '';
        const contentType = request.headers.get('content-type') || '';

        if (contentType.includes('multipart/form-data')) {
            const formData = await request.formData();
            jobId = formData.get('jobId') as string;
        }
        else if (contentType.includes('application/json')) {
            const body = await request.json();
            jobId = String(body?.jobId || '');
        }
        else {
            jobId = await request.text();
        }

        if (!jobId || typeof jobId !== 'string') {
            return Response.json({ success: false, error: 'Invalid Job ID' }, { status: 400 });
        }

        const ext = path.extname(jobId);
        const baseId = ext ? path.basename(jobId, ext) : path.basename(jobId);
        const uploadDir = path.resolve('./upload');

        let files: string[] = [];
        try {
            files = await readdir(uploadDir);
        }
        catch (error: unknown) {
            const err = error as NodeJS.ErrnoException;
            if (err.code === 'ENOENT') return Response.json({ success: true });
            throw error;
        }

        const deletePromises = files
            .filter((file) => file.includes(baseId))
            .map((file) =>
                unlink(path.join(uploadDir, file)).catch((error: NodeJS.ErrnoException) => {
                    if (error.code !== 'ENOENT') {
                        console.warn(`[Cleanup API] Failed to delete ${file}:`, error.message);
                    }
                })
            );

        await Promise.allSettled(deletePromises);
        jobProgress.delete(jobId);

        return Response.json({ success: true });
    }
    catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('[Cleanup API] Error:', msg);
        return Response.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
    }
};
