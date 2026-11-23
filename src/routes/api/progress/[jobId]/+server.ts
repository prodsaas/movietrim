import { jobProgress } from '#lib/server/progress.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
    const data = jobProgress.get(params.jobId) || { percent: 0, status: '' };

    return Response.json(data, {
        headers: {
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0',
            'Surrogate-Control': 'no-store'
        }
    });
};
