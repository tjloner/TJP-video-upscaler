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

// Initialize Web Worker for Video Processing
const worker = new Worker(new URL('./worker.ts', import.meta.url));

// DOM and Video State
let upscaled_canvas: HTMLCanvasElement;
let original_canvas: HTMLCanvasElement;
let video: HTMLVideoElement;
let download_name: string;
let inputFileHandle: FileSystemFileHandle;
let isOffscreenTransferred = false;
let imageCompareInstance: any = null;
let wakeLockSentinel: any = null;

// Image Upscaler State
let activeImageBitmap: ImageBitmap | null = null;
let imageDownloadName = "enhanced-image.png";

const weights = {
    'large': {
        'an': require('./weights/cnn-2x-l-an.json'),
        'rl': require('./weights/cnn-2x-l-rl.json'),
        '3d': require('./weights/cnn-2x-l-3d.json'),
    }
};

// Global Window Declarations for Alpine.js & HTML event bindings
declare global {
    interface Window {
        chooseFile: (e?: Event) => Promise<void>;
        initRecording: () => Promise<void>;
        updateScale: (scale: number) => void;
        togglePause: () => void;
        showSaveFilePicker: (options?: any) => Promise<FileSystemFileHandle>;
        showOpenFilePicker: (options?: any) => Promise<FileSystemFileHandle[]>;
        
        // Image Upscaler Global Handlers
        switchAppMode: (mode: 'video' | 'image') => void;
        chooseImageFile: (e?: Event) => Promise<void>;
        startImageUpscale: () => Promise<void>;
        updateImageScale: (scale: number) => void;
        updateImagePreset: (preset: ImageModelPreset) => void;
    }
}

document.addEventListener("DOMContentLoaded", index);

async function index(): Promise<void> {
    // Shared Alpine Stores
    Alpine.store('appMode', 'video'); // 'video' | 'image'
    
    // Video Stores
    Alpine.store('state', 'init');
    Alpine.store('scale', 2);
    Alpine.store('target', 'blob');
    Alpine.store('download_url', '');
    Alpine.store('isAlready4K', false);

    // Image Stores
    Alpine.store('imageState', 'init'); // 'init' | 'preview' | 'processing' | 'complete'
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
    
    // Bind Globals
    window.chooseFile = chooseFile;
    window.switchAppMode = switchAppMode;
    window.chooseImageFile = chooseImageFile;
    window.startImageUpscale = startImageUpscale;
}

function showUnsupported(text: string): void {
    Alpine.store('component', text);
    Alpine.store('state', 'unsupported');
}

/**
 * Top App Mode Switcher (Video vs Image)
 */
function switchAppMode(mode: 'video' | 'image'): void {
    Alpine.store('appMode', mode);
}

// ============================================================================
// IMAGE UPSCALER LOGIC (Nero AI Style)
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
            // Fallback input trigger
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

        // Draw preview to DOM original image canvas
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
    } catch (err: any) {
        Alpine.store('imageError', 'Failed to decode image file. Please use a standard PNG, JPEG, or WebP image.');
        Alpine.store('imageState', 'error');
    }
}

async function startImageUpscale(): Promise<void> {
    if (!activeImageBitmap) return;

    Alpine.store('imageState', 'processing');

    try {
        const scale = (Alpine.store('imageScale') as 2 | 4) || 2;
        const preset = (Alpine.store('imagePreset') as ImageModelPreset) || 'photo';

        // Run high-speed in-browser WebGPU pass
        const upscaledBlob = await upscaleImage(activeImageBitmap, { scale, preset });

        const downloadUrl = URL.createObjectURL(upscaledBlob);
        Alpine.store('imageDownloadUrl', downloadUrl);

        // Render preview of upscaled image
        const imgUpscaledPreview = document.getElementById('img-upscaled-preview') as HTMLImageElement;
        if (imgUpscaledPreview) {
            imgUpscaledPreview.src = downloadUrl;
        }

        Alpine.store('imageState', 'complete');
    } catch (err: any) {
        Alpine.store('imageError', err?.message || 'WebGPU Image Upscale failed. Check hardware acceleration.');
        Alpine.store('imageState', 'error');
    }
}

// ============================================================================
// VIDEO ENHANCER LOGIC (Preserved 100%)
// ============================================================================

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
        const vWidth = video.videoWidth;
        const vHeight = video.videoHeight;

        if (!vWidth || !vHeight || isNaN(vWidth) || isNaN(vHeight)) {
            return showError("Could not extract frame dimensions. The video stream may be corrupt.");
        }
        if (!video.duration || isNaN(video.duration) || video.duration <= 0) {
            return showError("Video duration is 0 seconds. The video does not contain playable frames.");
        }

        if (video.duration > 300) {
            return showError("Video exceeds 5 minutes. Browser-based processing is optimized for clips under 5 minutes to prevent tab memory limits.");
        }

        Alpine.store('width', vWidth);
        Alpine.store('height', vHeight);

        const containerWidth = imageCompareOuter.parentElement?.clientWidth || 560;
        const isPortrait = vHeight > vWidth;

        if (isPortrait) {
            const targetHeight = 420;
            const targetWidth = Math.round(targetHeight * (vWidth / vHeight));
            imageCompareOuter.style.width = `${targetWidth}px`;
            imageCompareOuter.style.height = `${targetHeight}px`;
        } else {
            const targetHeight = Math.min(360, Math.round(containerWidth * (vHeight / vWidth)));
            imageCompareOuter.style.width = '100%';
            imageCompareOuter.style.height = `${targetHeight}px`;
        }

        imageCompareOuter.style.margin = 'auto';
        imageCompareOuter.style.position = 'relative';

        if (imageCompareInstance && typeof imageCompareInstance.destroy === 'function') {
            try { imageCompareInstance.destroy(); } catch {}
        }
        imageCompareInstance = new ImageCompare(imageCompareEl).mount();

        video.onseeked = async () => {
            await renderInitialPreview();
        };

        video.currentTime = Math.min(2.5, Math.max(0.5, video.duration * 0.25));

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
    };

    async function renderInitialPreview() {
        if (Alpine.store('state') === 'preview') return;

        window.initRecording = initRecording;

        window.updateScale = function (scale: number): void {
            Alpine.store('scale', scale);
            const bitrate = scale === 4 ? 26e6 : 9.5e6;
            const estimated_size = (bitrate / 8) * video.duration + (128 / 8) * video.duration;
            Alpine.store('size', humanFileSize(estimated_size));
        };

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
                    weights: weights['large']['rl']
                }
            });
        } catch (e) {
            console.warn("Preview initial note:", e);
        }

        const is4K = (video.videoWidth >= 1440 && video.videoHeight >= 2560) || (video.videoWidth >= 2160 || video.videoHeight >= 2160);
        Alpine.store('isAlready4K', is4K);

        if (is4K) {
            Alpine.store('scale', 1);
        } else {
            Alpine.store('scale', 2);
        }

        const activeScale = (Alpine.store('scale') as number) || 1;
        const bitrate = activeScale === 4 ? 26e6 : (activeScale === 1 ? 16e6 : 9.5e6);
        const estimated_size = (bitrate / 8) * video.duration + (128 / 8) * video.duration;

        Alpine.store('target', 'blob');
        Alpine.store('size', humanFileSize(estimated_size));
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

    const targetScale = (Alpine.store('scale') as number) || 2;
    const bitrate = targetScale === 4 ? 26e6 : 9.5e6;
    const estimated_size = (bitrate / 8) * video.duration + (128 / 8) * video.duration;

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
        targetScale
    } as any);
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
    let userMessage = String(message);
    if (userMessage.includes("NotSupportedError")) {
        userMessage = "GPU Codec Error: Your device hardware video encoder cannot output at this resolution. The target resolution has been adjusted.";
    } else if (userMessage.includes("reading 'width'")) {
        userMessage = "Video Dimension Error: Unable to read frame dimensions. Please try reloading the page.";
    } else if (userMessage.includes("QuotaExceededError")) {
        userMessage = "Disk Quota Exceeded: Your browser ran out of local memory. Please free up disk space and try again.";
    }
    Alpine.store('error', userMessage);
}

function getBitrate(): number {
    return 14e6 * Math.sqrt((video.videoWidth * video.videoHeight * 4) / (1280 * 720));
}

function humanFileSize(bytes: number, si = false, dp = 1): string {
    const thresh = si ? 1000 : 1024;
    if (Math.abs(bytes) < thresh) return bytes + ' B';
    const units = ['KiB', 'MiB', 'GiB', 'TiB'];
    let u = -1;
    const r = 10 ** dp;
    do {
        bytes /= thresh;
    } while (Math.round(Math.abs(bytes) * r) / r >= thresh && u < units.length - 1);
    return bytes.toFixed(dp) + ' ' + units[u];
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