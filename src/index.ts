import Alpine from 'alpinejs';
import ImageCompare from './lib/image-compare-viewer.min';
import WebSR from '@websr/websr';
import type { WorkerRequestMessage, WorkerResponseMessage } from './types/worker-messages';

import 'bootstrap';
import 'bootstrap/dist/css/bootstrap.min.css';
import "./index.css";
import "./lib/image-compare-viewer.min.css";

const MAX_FILE_BLOB_SIZE = 1900 * 1024 * 1024;

const worker = new Worker(new URL('./worker.ts', import.meta.url));

let upscaled_canvas: HTMLCanvasElement;
let original_canvas: HTMLCanvasElement;
let video: HTMLVideoElement;

type NetworkSize = 'small' | 'medium' | 'large';
type ContentType = 'rl' | 'an' | '3d';

// UPGRADE: Default to 'large' network for maximum neural clarity
let size: NetworkSize = 'large';
let content: ContentType = 'rl';

let download_name: string;
let inputFileHandle: FileSystemFileHandle;

const weights: Record<NetworkSize, Record<ContentType, any>> = {
    'large': {
        'rl': require('./weights/cnn-2x-l-rl.json'),
        'an': require('./weights/cnn-2x-l-an.json'),
        '3d': require('./weights/cnn-2x-l-3d.json'),
    },
    'medium': {
        'rl': require('./weights/cnn-2x-m-rl.json'),
        'an': require('./weights/cnn-2x-m-an.json'),
        '3d': require('./weights/cnn-2x-m-3d.json'),
    },
    'small': {
        'rl': require('./weights/cnn-2x-s-rl.json'),
        'an': require('./weights/cnn-2x-s-an.json'),
        '3d': require('./weights/cnn-2x-s-3d.json'),
    }
};

const networks: Record<NetworkSize, { name: string }> = {
    'small': { name: "anime4k/cnn-2x-s" },
    'medium': { name: "anime4k/cnn-2x-m" },
    'large': { name: "anime4k/cnn-2x-l" }
};

declare global {
    interface Window {
        chooseFile: (e?: Event) => Promise<void>;
        initRecording: () => Promise<void>;
        fullScreenPreview: (e?: Event) => Promise<void>;
        switchNetworkSize: (el: HTMLInputElement) => Promise<void>;
        switchNetworkStyle: (el: HTMLInputElement) => Promise<void>;
        showSaveFilePicker: (options?: any) => Promise<FileSystemFileHandle>;
        showOpenFilePicker: (options?: any) => Promise<FileSystemFileHandle[]>;
        togglePause: () => void;
    }
}

document.addEventListener("DOMContentLoaded", index);

async function index(): Promise<void> {
    Alpine.store('state', 'init');
    Alpine.start();
    document.body.style.display = "block";

    upscaled_canvas = document.getElementById("upscaled") as HTMLCanvasElement;
    original_canvas = document.getElementById('original') as HTMLCanvasElement;

    if (!("VideoEncoder" in window)) return showUnsupported("WebCodecs");
    if (!window.showSaveFilePicker) return showUnsupported("File System Access API");

    worker.postMessage({ cmd: 'isSupported' } satisfies WorkerRequestMessage);
    window.chooseFile = chooseFile;
}

function showUnsupported(text: string): void {
    Alpine.store('component', text);
    Alpine.store('state', 'unsupported');
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
    download_name = file.name.split(".")[0] + "-TJP-upscaled.mp4";
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

    const imageCompare = document.getElementById('image-compare-outer') as HTMLElement;

    video.onloadedmetadata = async function () {
        const vWidth = video.videoWidth;
        const vHeight = video.videoHeight;

        Alpine.store('width', vWidth);
        Alpine.store('height', vHeight);
        upscaled_canvas.width = vWidth * 2;
        upscaled_canvas.height = vHeight * 2;
        original_canvas.width = vWidth * 2;
        original_canvas.height = vHeight * 2;

        // Universal Aspect Ratio Display: handles 16:9, 9:16 vertical, 1:1 square, etc.
        const containerWidth = imageCompare.parentElement?.clientWidth || 560;
        const isPortrait = vHeight > vWidth;

        if (isPortrait) {
            // Vertical / TikTok / Shorts video (9:16)
            const targetHeight = 420;
            const targetWidth = Math.round(targetHeight * (vWidth / vHeight));
            imageCompare.style.width = `${targetWidth}px`;
            imageCompare.style.height = `${targetHeight}px`;
        } else {
            // Landscape / Widescreen video (16:9, 21:9)
            const targetHeight = Math.min(360, Math.round(containerWidth * (vHeight / vWidth)));
            imageCompare.style.width = '100%';
            imageCompare.style.height = `${targetHeight}px`;
        }

        imageCompare.style.margin = 'auto';
        imageCompare.style.position = 'relative';

        new ImageCompare(document.getElementById('image-compare')).mount();

        const onFrameReady = async () => {
            await renderInitialPreview();
        };

        video.onseeked = onFrameReady;
        video.currentTime = Math.min(1.0, video.duration * 0.1 || 0);

        setTimeout(() => {
            if (Alpine.store('state') === 'loading') {
                onFrameReady();
            }
        }, 1200);

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
        window.fullScreenPreview = fullScreenPreview;

        try {
            const bitmap = await createImageBitmap(video);
            const upscaled = upscaled_canvas.transferControlToOffscreen();
            const original = original_canvas.transferControlToOffscreen();

            worker.postMessage({
                cmd: "init",
                data: {
                    bitmap,
                    upscaled,
                    original,
                    resolution: {
                        width: video.videoWidth,
                        height: video.videoHeight
                    }
                }
            }, [bitmap, upscaled, original]);

            await updateNetwork();
            Alpine.store('style', content);
        } catch (e) {
            console.warn("Preview transfer:", e);
        }

        const bitrate = getBitrate();
        const estimated_size = (bitrate / 8) * video.duration + (128 / 8) * video.duration;

        if (estimated_size > MAX_FILE_BLOB_SIZE) {
            Alpine.store('target', 'writer');
        } else {
            Alpine.store('target', 'blob');
        }

        Alpine.store('size', humanFileSize(estimated_size));
        Alpine.store('state', 'preview');

        window.switchNetworkSize = async function (el: HTMLInputElement) {
            if (el.value !== size) {
                size = el.value as NetworkSize;
                await updateNetwork();
            }
        };

        window.switchNetworkStyle = async function (el: HTMLInputElement) {
            if (el.value !== content) {
                content = el.value as ContentType;
                await updateNetwork();
            }
        };
    }

    async function fullScreenPreview() {
        imageCompare.requestFullscreen();
    }
}

worker.onmessage = function (event: MessageEvent<any>) {
  if (event.data.cmd === 'isSupported') {
    if (!event.data.data) return showUnsupported("WebGPU");
  } else if (event.data.cmd === 'sourceReport') {
    Alpine.store('sourceReport', event.data.data);
  } else if (event.data.cmd === 'progress') {
    Alpine.store('progress', event.data.data);
    if (Alpine.store('state') !== 'paused') Alpine.store('state', 'processing');
  } else if (event.data.cmd === 'eta') {
    Alpine.store('eta', event.data.data);
  } else if (event.data.cmd === 'finished') {
    Alpine.store('state', 'complete');
    Alpine.store('report', event.data.report);
    Alpine.store('download_url', event.data.data ? window.URL.createObjectURL(event.data.data) : null);
  } else if (event.data.cmd === 'error') {
    showError(event.data.data);
  }
};

async function updateNetwork(): Promise<void> {
    try {
        const bitmap = await createImageBitmap(video);
        worker.postMessage({
            cmd: 'network',
            data: {
                name: networks[size].name,
                bitmap,
                weights: weights[size][content]
            }
        } satisfies WorkerRequestMessage);
    } catch (e) {
        console.warn("Network update:", e);
    }
}

async function initRecording(): Promise<void> {
    Alpine.store('state', 'loading');

    const bitrate = getBitrate();
    const estimated_size = (bitrate / 8) * video.duration + (128 / 8) * video.duration;

    let outputHandle: FileSystemFileHandle | undefined;

    if (estimated_size > MAX_FILE_BLOB_SIZE) {
        try {
            outputHandle = await showFilePicker();
        } catch {
            return Alpine.store('state', 'preview');
        }
    }

    worker.postMessage({
        cmd: "process",
        inputHandle: inputFileHandle,
        outputHandle
    } satisfies WorkerRequestMessage);
}

function showError(message: string): void {
    Alpine.store('state', 'error');
    Alpine.store('error', message);
}

function getBitrate(): number {
    return 10e6 * Math.sqrt((video.videoWidth * video.videoHeight * 4) / (1280 * 720));
}

function humanFileSize(bytes: number, si = false, dp = 1): string {
    const thresh = si ? 1000 : 1024;
    if (Math.abs(bytes) < thresh) return bytes + ' B';
    const units = ['KiB', 'MiB', 'GiB', 'TiB'];
    let u = -1;
    const r = 10 ** dp;
    do {
        bytes /= thresh;
        ++u;
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