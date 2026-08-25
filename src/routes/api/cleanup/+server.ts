import { json } from '@sveltejs/kit';
import path from 'path';
import { readdir, unlink } from 'fs/promises';
import { jobProgress } from '$lib/server/progress';
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
            jobId = body?.jobId;
        }
        else {
            jobId = await request.text();
        }

        if (!jobId || typeof jobId !== 'string') return json({ success: false });

        const ext = path.extname(jobId);
        const baseId = ext ? path.basename(jobId, ext) : jobId;

        const uploadDir = path.resolve('./upload');
        let files;

        try {
            files = await readdir(uploadDir);
        }
        catch (error: unknown) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return json({ success: true });
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

        return json({ success: true });
    }
    catch (error) {
        console.error('[Cleanup API] Critical Error:', error);
        return json({ success: false });
    }
};