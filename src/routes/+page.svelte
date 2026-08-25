<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    import type { Track } from "./api/upload/+server";

    interface UploadResponse {
        success?: boolean;
        jobId?: string;
        audios?: Track[];
        subtitles?: Track[];
        error?: string;
    }

    let { data } = $props();

    let step = $state(0);

    let jobId = $state("");
    let audios = $state<Track[]>([]);
    let subtitles = $state<Track[]>([]);

    let startTime = $state("00:00:00");
    let endTime = $state("00:00:00");

    let audioIndex = $state<number>(-1);
    let subtitleIndex = $state<number>(-1);

    let audioFile = $state<File | null>(null);
    let subtitleFile = $state<File | null>(null);

    let progressPercent = $state(0);
    let progressStatus = $state("");
    let serverProgressInterval: ReturnType<typeof setInterval> | undefined;

    onDestroy(() => {
        if (serverProgressInterval) clearInterval(serverProgressInterval);
    });

    onMount(() => {
        let isCleaningUp = false;

        const handleUnload = () => {
            if (jobId && step > 0 && step < 4 && !isCleaningUp) {
                isCleaningUp = true;
                const formData = new FormData();
                formData.append("jobId", jobId);
                navigator.sendBeacon("/api/cleanup", formData);
            }
        };

        const onVisibilityChange = () => {
            if (document.visibilityState === "hidden") handleUnload();
        };

        document.addEventListener("visibilitychange", onVisibilityChange);
        window.addEventListener("pagehide", handleUnload);

        return () => {
            document.removeEventListener(
                "visibilitychange",
                onVisibilityChange,
            );
            window.removeEventListener("pagehide", handleUnload);
        };
    });

    function validateFile(
        event: Event,
        extensions: string[],
        errorMessage: string,
    ): File | null {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0];
        if (!file) return null;

        if (!extensions.some((ext) => file.name.toLowerCase().endsWith(ext))) {
            alert(errorMessage);
            input.value = "";
            return null;
        }
        return file;
    }

    function handleFileUpload(e: Event) {
        const file = validateFile(
            e,
            [".mp4", ".mkv", ".avi", ".mov", ".webm"],
            "Invalid video file.",
        );
        if (file) uploadFile(file);
    }

    function handleAudioUpload(e: Event) {
        audioFile = validateFile(
            e,
            [".mp3", ".wav", ".aac", ".m4a", ".ogg", ".flac"],
            "Invalid audio format.",
        );
    }

    function handleSubtitleUpload(e: Event) {
        subtitleFile = validateFile(
            e,
            [".srt", ".vtt", ".ass"],
            "Invalid subtitle format.",
        );
    }

    function uploadChunk(
        formData: FormData,
        chunkIndex: number,
        totalChunks: number,
    ): Promise<UploadResponse> {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable) {
                    progressPercent = Math.round(
                        ((chunkIndex + e.loaded / e.total) / totalChunks) * 100,
                    );
                    if (progressPercent === 100)
                        progressStatus = "Scanning audio and subtitle";
                }
            };
            xhr.onload = () => {
                try {
                    const res = JSON.parse(xhr.responseText);
                    if (xhr.status >= 200 && xhr.status < 300) resolve(res);
                    else
                        reject(new Error(res.error || "Server rejected file."));
                } catch {
                    reject(new Error("Invalid server response."));
                }
            };
            xhr.onerror = () => reject(new Error("Network connection lost."));
            xhr.open("POST", "/api/upload", true);
            xhr.send(formData);
        });
    }

    function getDurationInSeconds(start: string, end: string) {
        const toSec = (t: string) =>
            t.split(":").reduce((acc, val) => acc * 60 + Number(val), 0);
        return toSec(end) - toSec(start);
    }

    async function uploadFile(file: File) {
        step = 1;
        progressPercent = 0;
        progressStatus = "Uploading file";

        const chunkSize = 50 * 1024 * 1024;
        const totalChunks = Math.ceil(file.size / chunkSize);

        try {
            for (let i = 0; i < totalChunks; i++) {
                const chunk = file.slice(
                    i * chunkSize,
                    Math.min((i + 1) * chunkSize, file.size),
                );

                const formData = new FormData();
                formData.append("filename", file.name);
                formData.append("chunkIndex", i.toString());
                formData.append("totalChunks", totalChunks.toString());
                if (jobId) formData.append("jobId", jobId);
                formData.append("video", chunk);

                const result = await uploadChunk(formData, i, totalChunks);

                if (result.success && result.jobId) {
                    jobId = result.jobId;
                    if (i === totalChunks - 1) {
                        audios = result.audios || [];
                        subtitles = result.subtitles || [];
                    }
                } else {
                    throw new Error(result.error || "Unknown upload error");
                }
            }

            const defaultAudio = audios.find((a) => a.isDefault) || audios[0];
            audioIndex = defaultAudio ? defaultAudio.index : -1;
            subtitleIndex = -1;

            audioFile = null;
            subtitleFile = null;
            step = 2;
        } catch (error: unknown) {
            const msg =
                error instanceof Error ? error.message : "Unknown upload error";
            progressStatus = `Upload failed: ${msg}`;
            alert(`Upload Failed: ${msg}`);
            step = 0;
        }
    }

    async function executeTrim() {
        const timeRegex = /^\d+:[0-5]\d:[0-5]\d$/;
        if (!timeRegex.test(startTime)) {
            return alert(
                "Invalid Start Time. Please use HH:MM:SS format. Minutes and seconds must be between 00 and 59.",
            );
        }
        if (!timeRegex.test(endTime)) {
            return alert(
                "Invalid End Time. Please use HH:MM:SS format. Minutes and seconds must be between 00 and 59.",
            );
        }

        const duration = getDurationInSeconds(startTime, endTime);
        if (duration <= 0) {
            return alert("End Time must be greater than Start Time.");
        }

        if (audioIndex === -2 && !audioFile)
            return alert("Please upload audio file.");
        if (subtitleIndex === -2 && !subtitleFile)
            return alert("Please upload subtitle file.");

        step = 3;
        progressPercent = 0;
        progressStatus = "Initiating";

        serverProgressInterval = setInterval(async () => {
            try {
                const res = await fetch(
                    `/api/progress/${jobId}?t=${Date.now()}`,
                    {
                        cache: "no-store",
                    },
                );

                if (res.ok) {
                    const data = await res.json();
                    progressPercent = data.percent;
                    if (data.status) progressStatus = data.status;
                }
            } catch {
                // Ignore error
            }
        }, 1000);

        try {
            const formData = new FormData();
            formData.append("jobId", jobId);
            formData.append("startTime", startTime);
            formData.append("duration", duration.toString());
            formData.append("audioIndex", audioIndex.toString());
            formData.append("subtitleIndex", subtitleIndex.toString());

            if (audioIndex === -2 && audioFile)
                formData.append("customAudio", audioFile);
            if (subtitleIndex === -2 && subtitleFile)
                formData.append("customSubtitle", subtitleFile);

            const response = await fetch("/api/trim", {
                method: "POST",
                body: formData,
            });
            const result = await response.json();
            clearInterval(serverProgressInterval);

            if (result.success) {
                step = 4;
                progressPercent = 100;
                window.location.href = result.downloadUrl;
            } else {
                progressStatus = `Error: ${result.error || "Server processing failed"}`;
                alert(progressStatus);
                step = 2;
            }
        } catch (error: unknown) {
            clearInterval(serverProgressInterval);
            const msg =
                error instanceof Error ? error.message : "Network error";
            progressStatus = "Network connection lost.";
            alert(`Trim Request Failed: ${msg}`);
            step = 2;
        }
    }
</script>

{#if step === 0}
    <div class="h-[100dvh] grid place-items-center">
        {#if data.hasFFmpeg}
            <label for="video-upload" class="cursor-pointer">
                <span class="p-3 bg-black text-white hover:underline">
                    Upload Video
                </span>
                <input
                    id="video-upload"
                    type="file"
                    accept="video/*,.mkv"
                    onchange={handleFileUpload}
                    hidden
                />
            </label>
        {:else}
            Error: FFmpeg is not installed.
        {/if}
    </div>
{/if}

{#if step === 1 || step === 3}
    <div class="mx-auto max-w-sm w-full h-[100dvh] grid content-center gap-2">
        <div class="bg-gray-300">
            <div class="h-2 bg-black" style="width: {progressPercent}%"></div>
        </div>
        <div class="flex justify-between">
            <p>{progressStatus}</p>
            <p>{progressPercent}%</p>
        </div>
    </div>
{/if}

{#if step === 2}
    <ol class="mx-auto p-6 max-w-sm w-full grid gap-6 list-decimal">
        <li>
            <label for="start-time" class="font-bold">Start Time</label>
            <input
                id="start-time"
                type="text"
                bind:value={startTime}
                placeholder="HH:MM:SS"
                class="mt-2 p-2 w-full block text-center border"
            />
        </li>

        <li>
            <label for="end-time" class="font-bold">End Time</label>
            <input
                id="end-time"
                type="text"
                bind:value={endTime}
                placeholder="HH:MM:SS"
                class="mt-2 p-2 w-full block text-center border"
            />
        </li>

        <li>
            <b>Select Audio</b>
            <div class="mt-2 flex flex-col gap-2">
                <label class="flex items-center gap-2">
                    <input
                        type="radio"
                        name="audio"
                        value={-1}
                        bind:group={audioIndex}
                    />
                    <span>Do not add audio</span>
                </label>
                {#each audios as item (item.index)}
                    <label class="flex items-center gap-2">
                        <input
                            type="radio"
                            name="audio"
                            value={item.index}
                            bind:group={audioIndex}
                        />
                        <span>{item.title}</span>
                    </label>
                {/each}
                <label class="flex items-center gap-2">
                    <input
                        type="radio"
                        name="audio"
                        value={-2}
                        bind:group={audioIndex}
                    />
                    <span>Upload custom audio file</span>
                </label>
                {#if audioIndex === -2}
                    <input
                        type="file"
                        accept="audio/*"
                        onchange={handleAudioUpload}
                        class="p-2 w-full bg-gray-300 overflow-hidden cursor-pointer"
                    />
                {/if}
            </div>
        </li>

        <li>
            <b>Select Subtitle</b>
            <div class="mt-2 flex flex-col gap-2">
                <label class="flex items-center gap-2">
                    <input
                        type="radio"
                        name="subtitle"
                        value={-1}
                        bind:group={subtitleIndex}
                    />
                    <span>Do not add subtitle</span>
                </label>
                {#each subtitles as item (item.index)}
                    <label class="flex items-center gap-2">
                        <input
                            type="radio"
                            name="subtitle"
                            value={item.index}
                            bind:group={subtitleIndex}
                        />
                        <span>{item.title}</span>
                    </label>
                {/each}
                <label class="flex items-center gap-2">
                    <input
                        type="radio"
                        name="subtitle"
                        value={-2}
                        bind:group={subtitleIndex}
                    />
                    <span>Upload custom subtitle (.srt, .vtt, .ass)</span>
                </label>
                {#if subtitleIndex === -2}
                    <input
                        type="file"
                        accept=".srt,.vtt,.ass"
                        onchange={handleSubtitleUpload}
                        class="p-2 w-full bg-gray-300 overflow-hidden cursor-pointer"
                    />
                {/if}
            </div>
        </li>

        <li class="list-none">
            <button
                onclick={executeTrim}
                class="p-3 w-full bg-black text-white hover:underline cursor-pointer"
            >
                Trim Video Now
            </button>
        </li>
    </ol>
{/if}

{#if step === 4}
    <div class="h-[100dvh] grid content-center justify-items-center gap-2">
        <p>Download Started</p>
        <button
            onclick={() => (step = 0)}
            class="p-3 bg-black text-white hover:underline cursor-pointer"
        >
            Trim another video
        </button>
    </div>
{/if}
