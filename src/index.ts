import Alpine from 'alpinejs';
import ImageCompare from './lib/image-compare-viewer.min';
import WebSR from '@websr/websr';
import { upscaleImage, ImageModelPreset } from './processors/image-processor';
import type { WorkerRequestMessage } from './types/worker-messages';

import 'bootstrap';
import 'bootstrap/dist/css/bootstrap.min.css';
import "./index.css";
import "./lib/image-compare-viewer.min.css";

const MAX_FILE_BLOB_SIZE = 1900 * 1024 * 1024;

const worker = new Worker(new URL('./worker.ts', import.meta.url));

let upscaled_canvas: HTMLCanvasElement;
let original_canvas: HTMLCanvasElement;
let video: HTMLVideoElement;
let download_name: string;
let inputFileHandle: FileSystemFileHandle;
let isOffscreenTransferred = false;
let imageCompareInstance: any = null;
let wakeLockSentinel: any = null;

let activeImageBitmap: ImageBitmap | null = null;
let imageDownloadName = "enhanced-image.png";

export interface ResolutionTargetOption {
    label: string;
    targetWidth: number;
    targetHeight: number;
    scale: number;
    bitrate: number;
    tag: string;
}

const weights = {
    'large': {
        'an': require('./weights/cnn-2x-l-an.json'),
        'rl': require('./weights/cnn-2x-l-rl.json'),
        '3d': require('./weights/cnn-2x-l-3d.json'),
    }
};

declare global {
    interface Window {
        chooseFile: (e?: Event) => Promise<void>;
        initRecording: () => Promise<void>;
        selectTargetResolution: (index: number) => void;
        selectAIModelTier: (tier: string) => void;
        seekToTimestamp: (timeSeconds: number) => void;
        toggleZoom: () => void;
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
    Alpine.store('appMode', 'video');
    Alpine.store('state', 'init');
    Alpine.store('target', 'blob');
    Alpine.store('download_url', '');
    Alpine.store('availableOptions', [] as ResolutionTargetOption[]);
    Alpine.store('selectedOptionIndex', 0);
    Alpine.store('proTipMessage', '');
    Alpine.store('selectedAIModel', 'quality');
    Alpine.store('isZoomed', false);
    Alpine.store('timelineSnapshots', [] as { time: number; label: string }[]);

    Alpine.store('imageState', 'init');
    Alpine.store('imageScale', 2);
    Alpine.store('imagePreset', 'photo');
    Alpine.store('imageWidth', 0);
    Alpine.store('imageHeight', 0);
    Alpine.store('imageDownloadUrl', '');
    Alpine.store('imageDownloadName', '');
    Alpine.store('imageError', '');

    Alpine.start();
    document.body.style.display = "block";

    upscaled_canvas = document.getElementById("upscaled") as HTMLCanvasElement;
    original_canvas = document.getElementById('original') as HTMLCanvasElement;

    if (!("VideoEncoder" in window)) return showUnsupported("WebCodecs API");
    if (!window.showSaveFilePicker) return showUnsupported("File System Access API");

    worker.postMessage({ cmd: 'isSupported' } satisfies WorkerRequestMessage);
    
    window.chooseFile = chooseFile;
    window.switchAppMode = switchAppMode;
    window.chooseImageFile = chooseImageFile;
    window.startImageUpscale = startImageUpscale;
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
        Alpine.store('proTipMessage', 'Aiming for 4K? Upscale to 1080p first, then process that file to 4K for maximum clarity.');
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
    } else if (shortEdge <= 1600) {
        Alpine.store('proTipMessage', '2K Source Detected: Ready to upscale to 4K Ultra HD.');
        return [
            makeRes(2160, '4K Ultra HD', '1.5× 4K UHD', 22.0e6)
        ];
    } else {
        Alpine.store('proTipMessage', 'Source is already 4K UHD. Applying 1× AI Deblocking & Artifact Cleaning at native resolution.');
        return [
            {
                label: 'Native 4K AI Polish',
                targetWidth: inW,
                targetHeight: inH,
                scale: 1,
                bitrate: 18.0e6,
                tag: '1× Native'
            }
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
        console.log('File selection cancelled');
    }
}

async function loadVideo(fileHandle: FileSystemFileHandle): Promise<void> {
    Alpine.store('state', 'loading');
    inputFileHandle = fileHandle;

    const file = await fileHandle.getFile();

    if (file.size === 0) {
        return showError("The selected video file is empty (0 bytes). Please choose a valid MP4 file.");
    }

    download_name = file.name.split(".")[0] + "-TJP-ENHANCED.mp4";
    Alpine.store('download_name', download_name);
    Alpine.store('filename', file.name);

    const arrayBuffer = await file.arrayBuffer();
    await setupPreview(arrayBuffer);
}

async function setupPreview(data: ArrayBuffer): Promise<void> {
    video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;

    const fileBlob = new Blob([data], { type: "video/mp4" });
    video.src = URL.createObjectURL(fileBlob);

    const imageCompareOuter = document.getElementById('image-compare-outer') as HTMLElement;
    const imageCompareEl = document.getElementById('image-compare') as HTMLElement;

    video.onerror = function () {
        showError("Unable to decode this video stream. Please ensure it is an H.264/AAC MP4 video.");
    };

    video.onloadedmetadata = async function () {
        const vWidth = video.videoWidth || 640;
        const vHeight = video.videoHeight || 360;

        if (!video.duration || isNaN(video.duration) || video.duration <= 0) {
            return showError("Video duration is 0 seconds. The video contains no playable frames.");
        }

        Alpine.store('width', vWidth);
        Alpine.store('height', vHeight);

        // Aspect ratio bounds
        const containerWidth = imageCompareOuter.parentElement?.clientWidth || 560;
        const isPortrait = vHeight > vWidth;

        if (isPortrait) {
            const targetHeight = 440;
            const targetWidth = Math.round(targetHeight * (vWidth / vHeight));
            imageCompareOuter.style.width = `${targetWidth}px`;
            imageCompareOuter.style.height = `${targetHeight}px`;
        } else {
            const targetHeight = Math.min(380, Math.round(containerWidth * (vHeight / vWidth)));
            imageCompareOuter.style.width = '100%';
            imageCompareOuter.style.height = `${targetHeight}px`;
        }

        imageCompareOuter.style.margin = 'auto';
        imageCompareOuter.style.position = 'relative';

        // 5 Timeline Snapshots across duration
        const dur = video.duration;
        const snapshots = [
            { time: 0, label: '0:00' },
            { time: Math.min(dur * 0.2, dur - 0.5), label: formatTime(dur * 0.2) },
            { time: Math.min(dur * 0.4, dur - 0.5), label: formatTime(dur * 0.4) },
            { time: Math.min(dur * 0.65, dur - 0.5), label: formatTime(dur * 0.65) },
            { time: Math.min(dur * 0.85, dur - 0.5), label: formatTime(dur * 0.85) }
        ];
        Alpine.store('timelineSnapshots', snapshots);

        if (imageCompareInstance && typeof imageCompareInstance.destroy === 'function') {
            try { imageCompareInstance.destroy(); } catch {}
        }
        imageCompareInstance = new ImageCompare(imageCompareEl).mount();

        video.onseeked = async () => {
            await renderInitialPreview();
        };

        // Seek past opening fade
        video.currentTime = Math.min(2.0, Math.max(0.5, dur * 0.15));

        setTimeout(() => {
            if (Alpine.store('state') === 'loading') {
                renderInitialPreview();
            }
        }, 1400);

        window.togglePause = function () {
            const currentState = Alpine.store('state');
            if (currentState === 'processing') {
                worker.postMessage({ cmd: 'pause' } satisfies WorkerRequestMessage);
            } else if (currentState === 'paused') {
                worker.postMessage({ cmd: 'resume' } satisfies WorkerRequestMessage);
            }
        };

        window.seekToTimestamp = function (timeSec: number) {
            video.currentTime = timeSec;
        };

        window.toggleZoom = function () {
            const currentZoom = Alpine.store('isZoomed') as boolean;
            Alpine.store('isZoomed', !currentZoom);
            const slider = document.getElementById('image-compare');
            if (slider) {
                slider.style.transform = !currentZoom ? 'scale(2.2)' : 'scale(1.0)';
                slider.style.transformOrigin = 'center center';
                slider.style.transition = 'transform 0.25s ease-in-out';
            }
        };
    };

    async function renderInitialPreview() {
        if (Alpine.store('state') === 'preview') return;

        window.initRecording = initRecording;

        const options = calculateSmartResolutionOptions(video.videoWidth || 640, video.videoHeight || 360);
        Alpine.store('availableOptions', options);
        Alpine.store('selectedOptionIndex', options.length > 1 ? 1 : 0);

        window.selectTargetResolution = function (index: number): void {
            Alpine.store('selectedOptionIndex', index);
            const opt = (Alpine.store('availableOptions') as ResolutionTargetOption[])[index];
            if (opt) {
                const estimated_size = (opt.bitrate / 8) * video.duration + (128 / 8) * video.duration;
                Alpine.store('size', humanFileSize(estimated_size));
            }
        };

        window.selectAIModelTier = function (tier: string): void {
            Alpine.store('selectedAIModel', tier);
        };

        const activeOpt = options[Alpine.store('selectedOptionIndex') as number] || options[0];
        const estimated_size = (activeOpt.bitrate / 8) * video.duration + (128 / 8) * video.duration;
        Alpine.store('size', humanFileSize(estimated_size));

        try {
            const prevW = Math.min(1280, video.videoWidth || 640);
            const prevH = Math.min(720, video.videoHeight || 360);
            const bitmap = await createImageBitmap(video, { resizeWidth: prevW, resizeHeight: prevH });

            if (!isOffscreenTransferred) {
                const upscaled = upscaled_canvas.transferControlToOffscreen();
                const original = original_canvas.transferControlToOffscreen();
                isOffscreenTransferred = true;

                worker.postMessage({
                    cmd: "init",
                    data: {
                        bitmap,
                        upscaled,
                        original,
                        resolution: { width: prevW, height: prevH }
                    }
                }, [bitmap, upscaled, original]);
            } else {
                worker.postMessage({
                    cmd: "updatePreview",
                    data: {
                        bitmap,
                        resolution: { width: prevW, height: prevH }
                    }
                }, [bitmap]);
            }

            worker.postMessage({
                cmd: 'network',
                data: {
                    name: "anime4k/cnn-2x-l",
                    bitmap: await createImageBitmap(video, { resizeWidth: prevW, resizeHeight: prevH }),
                    weights: weights['large']['an'] // High-Acutance Vector Lines
                }
            });
        } catch (e) {
            console.warn("Preview setup handled:", e);
        }

        Alpine.store('target', 'blob');
        Alpine.store('state', 'preview');
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
    const aiModel = (Alpine.store('selectedAIModel') as string) || 'quality';

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
        aiModel
    } as any);
}

// IMAGE UPSCALER & UTILITIES
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
        activeImageBitmap = await createImageBitmap(file);
        Alpine.store('imageWidth', activeImageBitmap.width);
        Alpine.store('imageHeight', activeImageBitmap.height);
        Alpine.store('imageScale', 2);
        Alpine.store('imagePreset', 'photo');

        const imgOrigCanvas = document.getElementById('img-original-canvas') as HTMLCanvasElement;
        if (imgOrigCanvas) {
            imgOrigCanvas.width = activeImageBitmap.width;
            imgOrigCanvas.height = activeImageBitmap.height;
            const ctx = imgOrigCanvas.getContext('2d');
            ctx?.drawImage(activeImageBitmap, 0, 0);
        }

        Alpine.store('imageState', 'preview');

        window.updateImageScale = function(scale: number): void {
            Alpine.store('imageScale', scale);
        };

        window.updateImagePreset = function(preset: ImageModelPreset): void {
            Alpine.store('imagePreset', preset);
        };
    } catch {
        Alpine.store('imageError', 'Failed to decode image file. Please use PNG, JPEG, or WebP.');
        Alpine.store('imageState', 'error');
    }
}

async function startImageUpscale(): Promise<void> {
    if (!activeImageBitmap) return;

    Alpine.store('imageState', 'processing');

    try {
        const scale = (Alpine.store('imageScale') as 2 | 4) || 2;
        const preset = (Alpine.store('imagePreset') as ImageModelPreset) || 'photo';

        const upscaledBlob = await upscaleImage(activeImageBitmap, { scale, preset });
        const downloadUrl = URL.createObjectURL(upscaledBlob);
        Alpine.store('imageDownloadUrl', downloadUrl);

        const imgUpscaledPreview = document.getElementById('img-upscaled-preview') as HTMLImageElement;
        if (imgUpscaledPreview) {
            imgUpscaledPreview.src = downloadUrl;
        }

        Alpine.store('imageState', 'complete');
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