import Alpine from 'alpinejs';
import { upscaleImage, ImageModelPreset } from './processors/image-processor';
import type { WorkerRequestMessage, EngineMode } from './types/worker-messages';

import 'bootstrap';
import 'bootstrap/dist/css/bootstrap.min.css';
import "./index.css";

const MAX_FILE_BLOB_SIZE = 1900 * 1024 * 1024;

const worker = new Worker(new URL('./worker.ts', import.meta.url));

let upscaled_canvas: HTMLCanvasElement;
let original_canvas: HTMLCanvasElement;
let video: HTMLVideoElement;
let download_name: string;
let inputFileHandle: FileSystemFileHandle;
let isOffscreenTransferred = false;
let wakeLockSentinel: any = null;

let activeImageBitmap: ImageBitmap | null = null;
let originalImageSrcUrl: string = '';
let currentUpscaledBlobUrl: string = '';
let imageDownloadName = "enhanced-image.png";

export interface ResolutionTargetOption {
    label: string;
    targetWidth: number;
    targetHeight: number;
    scale: number;
    bitrate: number;
    tag: string;
}

declare global {
    interface Window {
        chooseFile: (e?: Event) => Promise<void>;
        initRecording: () => Promise<void>;
        selectTargetResolution: (index: number) => void;
        selectEngineMode: (mode: EngineMode) => void;
        seekToTimestamp: (timeSeconds: number) => void;
        toggleZoomMode: () => void;
        togglePause: () => void;
        showSaveFilePicker: (options?: any) => Promise<FileSystemFileHandle>;
        showOpenFilePicker: (options?: any) => Promise<FileSystemFileHandle[]>;
        switchAppMode: (mode: 'video' | 'image') => void;
        chooseImageFile: (e?: Event) => Promise<void>;
        startImageUpscale: () => Promise<void>;
        updateImageScale: (scale: number) => void;
        updateImagePreset: (preset: ImageModelPreset) => void;
    }
}

document.addEventListener("DOMContentLoaded", index);

async function index(): Promise<void> {
    // Video Stores
    Alpine.store('appMode', 'video');
    Alpine.store('state', 'init');
    Alpine.store('target', 'blob');
    Alpine.store('download_url', '');
    Alpine.store('availableOptions', [] as ResolutionTargetOption[]);
    Alpine.store('selectedOptionIndex', 0);
    Alpine.store('engineMode', 'deep');
    Alpine.store('proTipMessage', '');
    Alpine.store('isZoomed', false);
    Alpine.store('activeSnapshotTime', 0);
    Alpine.store('timelineSnapshots', [] as { time: number; label: string }[]);
    Alpine.store('width', 0);
    Alpine.store('height', 0);
    Alpine.store('progress', 0);
    Alpine.store('eta', '');
    Alpine.store('size', '');
    Alpine.store('filename', '');
    Alpine.store('error', '');

    // Image Stores
    Alpine.store('imageState', 'init');
    Alpine.store('imageScale', 2);
    Alpine.store('imagePreset', 'text');
    Alpine.store('imageWidth', 0);
    Alpine.store('imageHeight', 0);
    Alpine.store('imageDownloadUrl', '');
    Alpine.store('originalImageUrl', '');
    Alpine.store('imageDownloadName', '');
    Alpine.store('imageError', '');

    Alpine.start();
    document.body.style.display = "block";

    upscaled_canvas = document.getElementById("upscaled") as HTMLCanvasElement;
    original_canvas = document.getElementById('original') as HTMLCanvasElement;

    if (!("VideoEncoder" in window)) return showUnsupported("WebCodecs API");
    if (!window.showSaveFilePicker) return showUnsupported("File System Access API");

    worker.postMessage({ cmd: 'isSupported' } satisfies WorkerRequestMessage);
    
    // Global bindings
    window.chooseFile = chooseFile;
    window.switchAppMode = switchAppMode;
    window.chooseImageFile = chooseImageFile;
    window.startImageUpscale = triggerInstantImageEnhance;
    window.updateImageScale = async (scale: number) => {
        Alpine.store('imageScale', scale);
        await triggerInstantImageEnhance();
    };
    window.updateImagePreset = async (preset: ImageModelPreset) => {
        Alpine.store('imagePreset', preset);
        await triggerInstantImageEnhance();
    };
    window.toggleZoomMode = () => {
        const nextZoom = !Alpine.store('isZoomed');
        Alpine.store('isZoomed', nextZoom);
    };
}

function showUnsupported(text: string): void {
    Alpine.store('component', text);
    Alpine.store('state', 'unsupported');
}

function switchAppMode(mode: 'video' | 'image'): void {
    Alpine.store('appMode', mode);
}

function calculateSmartResolutionOptions(inW: number, inH: number): ResolutionTargetOption[] {
    const isPortrait = inH > inW;
    const shortEdge = Math.min(inW, inH);
    const aspect = isPortrait ? inH / inW : inW / inH;

    const makeRes = (targetShortEdge: number, label: string, tag: string, bitrate: number): ResolutionTargetOption => {
        let tW = isPortrait ? targetShortEdge : Math.round(targetShortEdge * aspect);
        let tH = isPortrait ? Math.round(targetShortEdge * aspect) : targetShortEdge;
        tW = Math.floor(tW / 2) * 2;
        tH = Math.floor(tH / 2) * 2;
        const scale = Number((tW / inW).toFixed(2));
        return { label, targetWidth: tW, targetHeight: tH, scale, bitrate, tag };
    };

    if (shortEdge <= 540) {
        Alpine.store('proTipMessage', 'Upscaling to 1080p recovers sharp text and sub-pixel edge definition.');
        return [
            makeRes(720, '720p HD', '2× HD', 7.5e6),
            makeRes(1080, '1080p Full HD', '3× Full HD', 11.0e6)
        ];
    } else if (shortEdge <= 800) {
        Alpine.store('proTipMessage', '4K UHD available! Scaled safely to 2160×3840 within GPU limits.');
        return [
            makeRes(1080, '1080p Full HD', '1.5× Full HD', 11.0e6),
            makeRes(1440, '2K Quad HD', '2× Quad HD', 15.0e6),
            makeRes(2160, '4K Ultra HD', '3× 4K UHD', 22.0e6)
        ];
    } else if (shortEdge <= 1200) {
        Alpine.store('proTipMessage', 'Full 4K Ultra HD target unlocked for your 1080p footage.');
        return [
            makeRes(1440, '2K Quad HD', '1.3× Quad HD', 15.0e6),
            makeRes(2160, '4K Ultra HD', '2× 4K UHD', 22.0e6)
        ];
    } else {
        Alpine.store('proTipMessage', 'High-resolution source: Applying 4K sub-pixel edge synthesis.');
        return [
            makeRes(2160, '4K Ultra HD', '1.5× 4K UHD', 24.0e6)
        ];
    }
}

async function chooseFile(e?: Event): Promise<void> {
    try {
        const [fileHandle] = await window.showOpenFilePicker({
            types: [{
                description: 'Video Files',
                accept: { 'video/mp4': ['.mp4'] }
            }],
            multiple: false
        });
        await loadVideo(fileHandle);
    } catch {
        console.log('Video selection cancelled');
    }
}

async function loadVideo(fileHandle: FileSystemFileHandle): Promise<void> {
    Alpine.store('state', 'loading');
    inputFileHandle = fileHandle;

    const file = await fileHandle.getFile();

    if (file.size === 0) {
        return showError("The selected video file is empty.");
    }

    download_name = file.name.split(".")[0] + "-TJP-ENHANCED.mp4";
    Alpine.store('download_name', download_name);
    Alpine.store('filename', file.name);

    const arrayBuffer = await file.arrayBuffer();
    await setupPreview(arrayBuffer);
}

async function setupPreview(data: ArrayBuffer): Promise<void> {
    const host = document.getElementById('hidden-video-host');
    if (host) host.innerHTML = '';

    video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';

    if (host) host.appendChild(video);

    const fileBlob = new Blob([data], { type: "video/mp4" });
    video.src = URL.createObjectURL(fileBlob);

    video.onerror = function () {
        showError("Unable to decode this video stream. Please ensure it is an H.264/AAC MP4 video.");
    };

    video.onloadeddata = async function () {
        const vWidth = video.videoWidth || 640;
        const vHeight = video.videoHeight || 360;

        Alpine.store('width', vWidth);
        Alpine.store('height', vHeight);

        // Explicitly size #player-frame to preserve video aspect ratio and avoid 0-pixel collapse
        const playerFrame = document.getElementById('player-frame');
        const isPortrait = vHeight > vWidth;
        const targetBoxHeight = 420;
        
        let displayWidth: number;
        let displayHeight: number;

        if (isPortrait) {
            displayHeight = targetBoxHeight;
            displayWidth = Math.round(targetBoxHeight * (vWidth / vHeight));
        } else {
            const containerMaxW = 540;
            displayHeight = Math.min(targetBoxHeight, Math.round(containerMaxW * (vHeight / vWidth)));
            displayWidth = Math.round(displayHeight * (vWidth / vHeight));
        }

        if (playerFrame) {
            playerFrame.style.width = `${displayWidth}px`;
            playerFrame.style.height = `${displayHeight}px`;
            playerFrame.style.minWidth = `${displayWidth}px`;
            playerFrame.style.minHeight = `${displayHeight}px`;
        }

        if (upscaled_canvas && original_canvas) {
            upscaled_canvas.width = vWidth * 2;
            upscaled_canvas.height = vHeight * 2;
            original_canvas.width = vWidth * 2;
            original_canvas.height = vHeight * 2;
        }

        const dur = video.duration || 10;
        const snapTimes = [
            Math.min(1.8, Math.max(0.8, dur * 0.15)),
            Math.min(dur * 0.35, Math.max(1.0, dur - 0.5)),
            Math.min(dur * 0.55, Math.max(1.5, dur - 0.5)),
            Math.min(dur * 0.75, Math.max(2.0, dur - 0.5)),
            Math.min(dur * 0.90, Math.max(2.5, dur - 0.5))
        ];

        const snapshots = [
            { time: snapTimes[0], label: formatTime(snapTimes[0]) },
            { time: snapTimes[1], label: formatTime(snapTimes[1]) },
            { time: snapTimes[2], label: formatTime(snapTimes[2]) },
            { time: snapTimes[3], label: formatTime(snapTimes[3]) },
            { time: snapTimes[4], label: formatTime(snapTimes[4]) }
        ];
        Alpine.store('timelineSnapshots', snapshots);
        Alpine.store('activeSnapshotTime', snapTimes[0]);

        video.onseeked = async () => {
            await new Promise(r => setTimeout(r, 60));
            await captureAndSendPreviewFrame();
        };

        // Skip potential initial black frame
        video.currentTime = snapTimes[0];

        // Backup render kick
        setTimeout(async () => {
            if (Alpine.store('state') === 'loading') {
                await captureAndSendPreviewFrame();
            }
        }, 800);

        window.seekToTimestamp = function (timeSec: number) {
            if (Alpine.store('state') === 'processing') return;
            Alpine.store('activeSnapshotTime', timeSec);
            video.currentTime = timeSec;
        };

        window.selectEngineMode = function (mode: EngineMode) {
            Alpine.store('engineMode', mode);
        };

        window.togglePause = function () {
            const currentState = Alpine.store('state');
            if (currentState === 'processing') {
                worker.postMessage({ cmd: 'pause' } satisfies WorkerRequestMessage);
            } else if (currentState === 'paused') {
                worker.postMessage({ cmd: 'resume' } satisfies WorkerRequestMessage);
            }
        };
    };

    async function captureAndSendPreviewFrame() {
        if (Alpine.store('state') !== 'processing') {
            window.initRecording = initRecording;

            const options = calculateSmartResolutionOptions(video.videoWidth || 640, video.videoHeight || 360);
            Alpine.store('availableOptions', options);

            if (!Alpine.store('selectedOptionIndex')) {
                Alpine.store('selectedOptionIndex', options.length - 1);
            }

            window.selectTargetResolution = function (index: number): void {
                Alpine.store('selectedOptionIndex', index);
                const opt = (Alpine.store('availableOptions') as ResolutionTargetOption[])[index];
                if (opt) {
                    const estimated_size = (opt.bitrate / 8) * video.duration + (128 / 8) * video.duration;
                    Alpine.store('size', humanFileSize(estimated_size));
                }
            };

            const activeOpt = options[Alpine.store('selectedOptionIndex') as number] || options[0];
            const estimated_size = (activeOpt.bitrate / 8) * video.duration + (128 / 8) * video.duration;
            Alpine.store('size', humanFileSize(estimated_size));

            Alpine.store('target', 'blob');
            Alpine.store('state', 'preview');
        }

        try {
            const w = video.videoWidth || 640;
            const h = video.videoHeight || 360;

            const frameBitmap = await createImageBitmap(video);

            if (!isOffscreenTransferred) {
                const upscaled = upscaled_canvas.transferControlToOffscreen();
                const original = original_canvas.transferControlToOffscreen();
                isOffscreenTransferred = true;

                worker.postMessage({
                    cmd: "init",
                    data: {
                        bitmap: frameBitmap,
                        upscaled,
                        original,
                        resolution: { width: w, height: h }
                    }
                }, [frameBitmap, upscaled, original]);
            } else {
                worker.postMessage({
                    cmd: "updatePreview",
                    data: {
                        bitmap: frameBitmap
                    }
                }, [frameBitmap]);
            }
        } catch (e) {
            console.warn("Frame capture error:", e);
        }
    }
}

worker.onmessage = function (event: MessageEvent<any>) {
    if (event.data.cmd === 'isSupported') {
        if (!event.data.data) return showUnsupported("WebGPU API");
    } else if (event.data.cmd === 'sourceReport') {
        Alpine.store('sourceReport', event.data.data);
    } else if (event.data.cmd === 'progress') {
        Alpine.store('progress', event.data.data);
        if (Alpine.store('state') !== 'paused') Alpine.store('state', 'processing');
    } else if (event.data.cmd === 'eta') {
        Alpine.store('eta', event.data.data);
    } else if (event.data.cmd === 'finished') {
        releaseScreenWakeLock();
        Alpine.store('state', 'complete');
        Alpine.store('report', event.data.report);
        const url = event.data.data ? window.URL.createObjectURL(event.data.data) : null;
        Alpine.store('download_url', url);
    } else if (event.data.cmd === 'error') {
        releaseScreenWakeLock();
        showError(event.data.data);
    }
};

async function initRecording(): Promise<void> {
    Alpine.store('state', 'loading');
    await requestScreenWakeLock();

    const options = (Alpine.store('availableOptions') as ResolutionTargetOption[]);
    const selectedIdx = (Alpine.store('selectedOptionIndex') as number) || 0;
    const activeOpt = options[selectedIdx] || options[0];
    const engineMode = (Alpine.store('engineMode') as EngineMode) || 'deep';

    const estimated_size = (activeOpt.bitrate / 8) * video.duration + (128 / 8) * video.duration;
    let outputHandle: FileSystemFileHandle | undefined;

    if (estimated_size > MAX_FILE_BLOB_SIZE) {
        try {
            outputHandle = await showFilePicker();
        } catch {
            releaseScreenWakeLock();
            return Alpine.store('state', 'preview');
        }
    }

    worker.postMessage({
        cmd: "process",
        inputHandle: inputFileHandle,
        outputHandle,
        targetWidth: activeOpt.targetWidth,
        targetHeight: activeOpt.targetHeight,
        targetScale: activeOpt.scale,
        targetBitrate: activeOpt.bitrate,
        engineMode: engineMode
    } as any);
}

// ============================================================================
// IMAGE UPSCALER (INSTANT NATIVE BEFORE/AFTER SPLIT SLIDER)
// ============================================================================

async function chooseImageFile(e?: Event): Promise<void> {
    try {
        if (window.showOpenFilePicker) {
            const [fileHandle] = await window.showOpenFilePicker({
                types: [{
                    description: 'Image Files',
                    accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.webp'] }
                }],
                multiple: false
            });
            const file = await fileHandle.getFile();
            await setupImageFile(file);
        } else {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/png, image/jpeg, image/webp';
            input.onchange = async () => {
                if (input.files && input.files[0]) {
                    await setupImageFile(input.files[0]);
                }
            };
            input.click();
        }
    } catch {
        console.log('Image selection cancelled');
    }
}

async function setupImageFile(file: File): Promise<void> {
    if (file.size === 0) {
        Alpine.store('imageError', 'The selected image file is empty.');
        Alpine.store('imageState', 'error');
        return;
    }

    imageDownloadName = file.name.split('.')[0] + "-TJP-UPSCALED.png";
    Alpine.store('imageDownloadName', imageDownloadName);

    try {
        if (originalImageSrcUrl) {
            URL.revokeObjectURL(originalImageSrcUrl);
        }

        activeImageBitmap = await createImageBitmap(file);
        originalImageSrcUrl = URL.createObjectURL(file);
        Alpine.store('originalImageUrl', originalImageSrcUrl);

        Alpine.store('imageWidth', activeImageBitmap.width);
        Alpine.store('imageHeight', activeImageBitmap.height);
        Alpine.store('imageScale', 2);
        Alpine.store('imagePreset', 'text');

        await triggerInstantImageEnhance();
    } catch {
        Alpine.store('imageError', 'Failed to decode image file. Please use PNG, JPEG, or WebP.');
        Alpine.store('imageState', 'error');
    }
}

async function triggerInstantImageEnhance(): Promise<void> {
    if (!activeImageBitmap) return;

    Alpine.store('imageState', 'processing');

    try {
        const scale = (Alpine.store('imageScale') as 2 | 4) || 2;
        const preset = (Alpine.store('imagePreset') as ImageModelPreset) || 'text';

        const upscaledBlob = await upscaleImage(activeImageBitmap, { scale, preset });

        if (currentUpscaledBlobUrl) {
            URL.revokeObjectURL(currentUpscaledBlobUrl);
        }

        currentUpscaledBlobUrl = URL.createObjectURL(upscaledBlob);
        Alpine.store('imageDownloadUrl', currentUpscaledBlobUrl);
        Alpine.store('imageState', 'preview');
    } catch (err: any) {
        Alpine.store('imageError', err?.message || 'WebGPU Image Upscale failed.');
        Alpine.store('imageState', 'error');
    }
}

async function requestScreenWakeLock(): Promise<void> {
    try {
        if ('wakeLock' in navigator) {
            wakeLockSentinel = await (navigator as any).wakeLock.request('screen');
        }
    } catch {}
}

function releaseScreenWakeLock(): void {
    try {
        if (wakeLockSentinel && typeof wakeLockSentinel.release === 'function') {
            wakeLockSentinel.release();
            wakeLockSentinel = null;
        }
    } catch {}
}

function showError(message: string): void {
    Alpine.store('state', 'error');
    Alpine.store('error', String(message));
}

function formatTime(secs: number): string {
    const s = Math.floor(secs);
    const m = Math.floor(s / 60);
    const remS = s % 60;
    return `${m}:${remS < 10 ? '0' : ''}${remS}`;
}

function humanFileSize(bytes: number): string {
    if (!bytes || isNaN(bytes) || bytes < 1024) return `${Math.round(bytes || 0)} B`;
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} KiB`;
    const mb = kb / 1024;
    if (mb < 1024) return `${mb.toFixed(1)} MiB`;
    const gb = mb / 1024;
    return `${gb.toFixed(1)} GiB`;
}

async function showFilePicker(): Promise<FileSystemFileHandle> {
    return await window.showSaveFilePicker({
        startIn: 'downloads',
        suggestedName: download_name,
        types: [{
            description: 'Video File',
            accept: { 'video/mp4': ['.mp4'] }
        }],
    });
}