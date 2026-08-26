export const jobProgress = new Map<string, {
    percent: number;
    status: string;
    downloadUrl?: string;
    error?: string;
}>();