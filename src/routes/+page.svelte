<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    import type { Track } from "./api/upload/+server";

    type Step = "UPLOAD" | "UPLOADING" | "SETUP" | "PROCESSING" | "DONE";

    interface UploadResponse {
        success?: boolean;
        jobId?: string;
        audios?: Track[];
        subtitles?: Track[];
        error?: string;
    }

    let { data } = $props();

    let step = $state<Step>("UPLOAD");

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
            if (
                jobId &&
                step !== "UPLOAD" &&
                step !== "DONE" &&
                !isCleaningUp
            ) {
                isCleaningUp = true;
                const formData = new FormData();
                formData.append("jobId", jobId);
                navigator.sendBeacon("/api/cleanup", formData);
            }
        };

        window.addEventListener("pagehide", handleUnload);

        return () => {
            window.removeEventListener("pagehide", handleUnload);
        };
    });

    function getDurationInSeconds(start: string, end: string): number {
        const toSec = (t: string) =>
            t.split(":").reduce((acc, val) => acc * 60 + Number(val), 0);
        return toSec(end) - toSec(start);
    }

    function handleFileSelection(
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

    function handleVideoUpload(e: Event) {
        const file = handleFileSelection(
            e,
            [".mp4", ".mkv", ".avi", ".mov", ".webm"],
            "Invalid video file.",
        );
        if (file) executeUpload(file);
    }

    async function executeUpload(file: File) {
        step = "UPLOADING";
        progressPercent = 0;
        progressStatus = "Uploading video...";

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

                const result = await new Promise<UploadResponse>(
                    (resolve, reject) => {
                        const xhr = new XMLHttpRequest();
                        xhr.upload.onprogress = (e) => {
                            if (e.lengthComputable) {
                                progressPercent = Math.round(
                                    ((i + e.loaded / e.total) / totalChunks) *
                                        100,
                                );
                                if (progressPercent === 100) {
                                    progressStatus = "Scanning media tracks...";
                                }
                            }
                        };
                        xhr.onload = () => {
                            try {
                                const res = JSON.parse(xhr.responseText);
                                if (xhr.status >= 200 && xhr.status < 300) {
                                    resolve(res);
                                } else {
                                    reject(
                                        new Error(
                                            res.error ||
                                                "Server rejected file.",
                                        ),
                                    );
                                }
                            } catch {
                                reject(new Error("Invalid server response."));
                            }
                        };
                        xhr.onerror = () =>
                            reject(new Error("Network connection lost."));
                        xhr.open("POST", "/api/upload", true);
                        xhr.send(formData);
                    },
                );

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

            step = "SETUP";
        } catch (error: unknown) {
            const err =
                error instanceof Error ? error : new Error(String(error));
            alert(`Upload Failed: ${err.message}`);
            step = "UPLOAD";
        }
    }

    async function executeTrim() {
        const timeRegex = /^\d+:[0-5]\d:[0-5]\d$/;
        if (!timeRegex.test(startTime) || !timeRegex.test(endTime)) {
            return alert(
                "Invalid Time format. Must be HH:MM:SS with minutes/seconds under 60.",
            );
        }

        const duration = getDurationInSeconds(startTime, endTime);
        if (duration <= 0)
            return alert("End Time must be strictly greater than Start Time.");

        if (audioIndex === -2 && !audioFile)
            return alert("Please upload your custom audio file.");
        if (subtitleIndex === -2 && !subtitleFile)
            return alert("Please upload your custom subtitle file.");

        step = "PROCESSING";
        progressPercent = 0;
        progressStatus = "Initializing render...";

        serverProgressInterval = setInterval(async () => {
            try {
                const res = await fetch(
                    `/api/progress/${jobId}?t=${Date.now()}`,
                    { cache: "no-store" },
                );
                if (!res.ok) return;

                const data = await res.json();

                if (data.percent === 100 && data.downloadUrl) {
                    clearInterval(serverProgressInterval);
                    progressPercent = 100;
                    step = "DONE";
                    window.location.href = data.downloadUrl;
                } else if (data.percent === -1) {
                    clearInterval(serverProgressInterval);
                    alert(data.status || "Processing failed during rendering.");
                    step = "SETUP";
                } else {
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

            if (!result.success) {
                clearInterval(serverProgressInterval);
                alert(`Error: ${result.error || "Server processing failed"}`);
                step = "SETUP";
            }
        } catch (error: unknown) {
            clearInterval(serverProgressInterval);
            const err =
                error instanceof Error ? error : new Error(String(error));
            progressStatus = "Network connection lost.";
            alert(`Trim Request Failed: ${err.message}`);
            step = "SETUP";
        }
    }
</script>

{#if step === "UPLOAD"}
    <div class="h-[100svh] grid place-items-center">
        {#if data.hasFFmpeg}
            <label for="video-upload" class="cursor-pointer">
                <span class="p-3 bg-black text-white hover:underline">
                    Upload Video
                </span>
                <input
                    id="video-upload"
                    type="file"
                    accept="video/*,.mkv"
                    onchange={handleVideoUpload}
                    hidden
                />
            </label>
        {:else}
            Error: FFmpeg is not installed.
        {/if}
    </div>
{/if}

{#if step === "UPLOADING" || step === "PROCESSING"}
    <div class="mx-auto max-w-sm w-full h-[100svh] grid content-center gap-2">
        <div class="bg-gray-300">
            <div class="h-2 bg-black" style="width: {progressPercent}%"></div>
        </div>
        <div class="flex justify-between">
            <p>{progressStatus}</p>
            <p>{progressPercent}%</p>
        </div>
    </div>
{/if}

{#if step === "SETUP"}
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
                    <span>Mute audio track</span>
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
                        accept=".mp3,.wav,.aac,.m4a,.ogg,.flac"
                        onchange={(e) =>
                            (audioFile = handleFileSelection(
                                e,
                                [
                                    ".mp3",
                                    ".wav",
                                    ".aac",
                                    ".m4a",
                                    ".ogg",
                                    ".flac",
                                ],
                                "Invalid audio format.",
                            ))}
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
                    <span>No subtitles</span>
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
                    <span>Upload custom (.srt, .vtt)</span>
                </label>
                {#if subtitleIndex === -2}
                    <input
                        type="file"
                        accept=".srt,.vtt,.ass"
                        onchange={(e) =>
                            (subtitleFile = handleFileSelection(
                                e,
                                [".srt", ".vtt", ".ass"],
                                "Invalid subtitle format.",
                            ))}
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
                Process Video
            </button>
        </li>
    </ol>
{/if}

{#if step === "DONE"}
    <div class="h-[100svh] grid content-center justify-items-center gap-2">
        <p>Download Started</p>
        <button
            onclick={() => (step = "UPLOAD")}
            class="p-3 bg-black text-white hover:underline cursor-pointer"
        >
            Process another video
        </button>
    </div>
{/if}
