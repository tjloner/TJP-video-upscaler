import Alpine from 'alpinejs';
import { upscaleImage, ImageModelPreset } from './processors/image-processor';
import { enhanceAudioFile } from './processors/audio-processor';
import { PatchPreviewController } from './processors/patch-preview';
import type { WorkerRequestMessage, EngineMode, VideoProfilePreset } from './types/worker-messages';

import 'bootstrap';
import 'bootstrap/dist/css/bootstrap.min.css';
import "./index.css";

const MAX_FILE_BLOB_SIZE = 1900 * 1024 * 1024;

const worker = new Worker(new URL('./worker.ts', import.meta.url));

let upscaled_canvas: HTMLCanvasElement;
let original_canvas: HTMLCanvasElement;
let video: HTMLVideoElement;
let download_name: string;
let inputFileHandle: any;
let isOffscreenTransferred = false;
let wakeLockSentinel: any = null;

let patchController: PatchPreviewController | null = null;

let activeImageBitmap: ImageBitmap | null = null;
let originalImageSrcUrl: string = '';
let currentUpscaledBlobUrl: string = '';
let imageDownloadName = "enhanced-image.png";

export type VideoModelFamily = 'sharpen' | 'detail';
export type VideoModelTier = 'fast' | 'balanced' | 'quality';

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
        selectVideoFamily: (family: VideoModelFamily) => void;
        selectVideoTier: (tier: VideoModelTier) => void;
        seekToTimestamp: (timeSeconds: number) => void;
        toggleZoomMode: () => void;
        togglePause: () => void;
        showSaveFilePicker: (options?: any) => Promise<FileSystemFileHandle>;
        showOpenFilePicker: (options?: any) => Promise<FileSystemFileHandle[]>;
        switchAppMode: (mode: 'video' | 'image' | 'audio') => void;
        chooseImageFile: (e?: Event) => Promise<void>;
        startImageUpscale: () => Promise<void>;
        updateImageScale: (scale: number) => void;
        updateImagePreset: (preset: ImageModelPreset) => void;
        updateAudioMode: (mode: 'voice' | 'music') => void;
        chooseAudioFile: (e?: Event) => Promise<void>;
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
    Alpine.store('videoFamily', 'detail' as VideoModelFamily);
    Alpine.store('videoTier', 'balanced' as VideoModelTier);
    Alpine.store('engineMode', 'deep');
    Alpine.store('proTipMessage', '');
    Alpine.store('previewLoading', false);
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

    Alpine.store('imageState', 'init');
    Alpine.store('imageScale', 4);
    Alpine.store('imagePreset', 'ultra' as ImageModelPreset);
    Alpine.store('imageWidth', 0);
    Alpine.store('imageHeight', 0);
    Alpine.store('imageDownloadUrl', '');
    Alpine.store('originalImageUrl', '');
    Alpine.store('imageDownloadName', '');
    Alpine.store('imageError', '');
    Alpine.store('imageStatusTitle', 'Synthesizing Sub-Pixel Details');
    Alpine.store('imageProgressMessage', 'Applying ESRGAN neural reconstruction...');
    Alpine.store('imageProgress', 0);

    Alpine.store('audioState', 'init');
    Alpine.store('audioMode', 'voice' as 'voice' | 'music');
    Alpine.store('audioFileName', '');
    Alpine.store('audioDuration', '');
    Alpine.store('audioDownloadUrl', '');
    Alpine.store('audioDownloadName', '');
    Alpine.store('audioProgress', 0);
    Alpine.store('audioProgressMessage', '');

    Alpine.start();
    document.body.style.display = "block";

    upscaled_canvas = document.getElementById("upscaled") as HTMLCanvasElement;
    original_canvas = document.getElementById('original') as HTMLCanvasElement;

    if (!("VideoEncoder" in window)) return showUnsupported("WebCodecs API");
    if (!window.showSaveFilePicker) return showUnsupported("File System Access API");

    worker.postMessage({ cmd: 'isSupported' } satisfies WorkerRequestMessage);
    
    window.chooseFile = chooseFile;
    window.switchAppMode = switchAppMode;

    // Pick up pending trial video dropped on landing.html
    window.chooseImageFile = chooseImageFile;
    window.chooseAudioFile = chooseAudioFile;
    window.updateAudioMode = (mode: 'voice' | 'music') => {
        Alpine.store('audioMode', mode);
    };
    window.startImageUpscale = triggerInstantImageEnhance;
    window.updateImageScale = async (scale: number) => {
        Alpine.store('imageScale', scale);
        await triggerInstantImageEnhance();
    };
    window.updateImagePreset = async (preset: ImageModelPreset) => {
        Alpine.store('imagePreset', preset);
        await triggerInstantImageEnhance();
    };
    window.toggleZoomMode = async () => {
        const nextZoom = !Alpine.store('isZoomed');
        Alpine.store('isZoomed', nextZoom);
        if (patchController) {
            patchController.setZoomMode(nextZoom);
        }
        Alpine.store('previewLoading', true);
        await updateLiveVideoPreview();
    };

    window.selectVideoFamily = async (family: VideoModelFamily) => {
        Alpine.store('videoFamily', family);
        Alpine.store('previewLoading', true);
        if (family === 'sharpen') {
            Alpine.store('proTipMessage', 'Sharpen mode: Restores crisp line boundaries (ideal for typography, anime, and logos).');
        } else {
            Alpine.store('proTipMessage', 'Detail mode: Reconstructs realistic textures, skin pores, hair, and fabric weave.');
        }
        await updateLiveVideoPreview();
    };

    window.selectVideoTier = async (tier: VideoModelTier) => {
        Alpine.store('videoTier', tier);
        Alpine.store('engineMode', tier === 'fast' ? 'fast' : 'deep');
        Alpine.store('previewLoading', true);
        await updateLiveVideoPreview();
    };
}

function showUnsupported(text: string): void {
    Alpine.store('component', text);
    Alpine.store('state', 'unsupported');
}

function switchAppMode(mode: 'video' | 'image' | 'audio'): void {
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
        return [
            makeRes(720, '720p HD', '2× HD', 7.5e6),
            makeRes(1080, '1080p Full HD', '3× Full HD', 11.0e6)
        ];
    } else if (shortEdge <= 800) {
        return [
            makeRes(1080, '1080p Full HD', '1.5× Full HD', 11.0e6),
            makeRes(1440, '2K Quad HD', '2× Quad HD', 15.0e6),
            makeRes(2160, '4K Ultra HD', '3× 4K UHD', 22.0e6)
        ];
    } else if (shortEdge <= 1200) {
        return [
            makeRes(1440, '2K Quad HD', '1.3× Quad HD', 15.0e6),
            makeRes(2160, '4K Ultra HD', '2× 4K UHD', 22.0e6)
        ];
    } else {
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
                accept: { 'video/mp4': ['.mp4'], 'video/webm': ['.webm'] }
            }],
            multiple: false
        });
        await loadVideo(fileHandle);
    } catch {
        console.log('Video selection cancelled');
    }
}

async function loadVideo(source: any): Promise<void> {
    Alpine.store('state', 'loading');
    inputFileHandle = source;

    // Safely resolve whether it's a FileSystemFileHandle or a direct File object
    const file: File = typeof source?.getFile === 'function'
        ? await source.getFile()
        : source;

    if (!file || file.size === 0) {
        return showError("The selected video file is empty or could not be read.");
    }

    download_name = file.name.split(".")[0] + "-TJP-ENHANCED.mp4";
    Alpine.store('download_name', download_name);
    Alpine.store('filename', file.name);

    // Bypass RAM entirely: pass the File directly to the player
    await setupPreview(file);
}

async function setupPreview(file: File): Promise<void> {
    const host = document.getElementById('hidden-video-host');
    if (host) host.innerHTML = '';

    video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';

    if (host) host.appendChild(video);

    video.src = URL.createObjectURL(file);

    video.onerror = function () {
        showError("Unable to decode this video stream. Please ensure it is an H.264/AAC MP4 video.");
    };

    video.onloadeddata = async function () {
        const vWidth = video.videoWidth || 640;
        const vHeight = video.videoHeight || 360;

        Alpine.store('width', vWidth);
        Alpine.store('height', vHeight);

        const playerFrame = document.getElementById('player-frame');
        const minimapCanvas = document.getElementById('patch-minimap') as HTMLCanvasElement;
        const viewportBox = document.getElementById('patch-viewport-box') as HTMLElement;
        const compareContainer = playerFrame?.parentElement as HTMLElement;

        if (minimapCanvas && viewportBox && playerFrame && compareContainer) {
            patchController = new PatchPreviewController({
                video,
                minimapCanvas,
                viewportBox,
                playerFrame,
                compareContainer,
                onCropChange: async () => {
                    Alpine.store('previewLoading', true);
                    await updateLiveVideoPreview();
                }
            });
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
            // Safe 50ms buffer to guarantee Chrome decodes the hidden frame
            await new Promise(r => setTimeout(r, 50));
            
            if (patchController) patchController.renderMinimap();
            Alpine.store('previewLoading', true);
            await updateLiveVideoPreview();
        };

        video.currentTime = snapTimes[0];

        window.seekToTimestamp = function (timeSec: number) {
            if (Alpine.store('state') === 'processing') return;
            Alpine.store('activeSnapshotTime', timeSec);
            Alpine.store('previewLoading', true);
            video.currentTime = timeSec;
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
}

async function updateLiveVideoPreview(): Promise<void> {
    if (!video) return;

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
        const currentFamily = (Alpine.store('videoFamily') as VideoModelFamily) || 'detail';
        const currentTier = (Alpine.store('videoTier') as VideoModelTier) || 'balanced';

        const patchBitmap = patchController 
            ? await patchController.getCroppedBitmap()
            : await createImageBitmap(video);

        const pw = Math.floor(patchBitmap.width / 2) * 2;
        const ph = Math.floor(patchBitmap.height / 2) * 2;

        if (!isOffscreenTransferred && upscaled_canvas && original_canvas) {
            const upscaled = upscaled_canvas.transferControlToOffscreen();
            const original = original_canvas.transferControlToOffscreen();
            isOffscreenTransferred = true;

            worker.postMessage({
                cmd: "init",
                family: currentFamily,
                tier: currentTier,
                data: {
                    bitmap: patchBitmap,
                    upscaled,
                    original,
                    resolution: { width: pw, height: ph }
                }
            }, [patchBitmap, upscaled, original]);
        } else {
            worker.postMessage({
                cmd: "updatePreview",
                family: currentFamily,
                tier: currentTier,
                data: {
                    bitmap: patchBitmap
                }
            }, [patchBitmap]);
        }
    } catch (e) {
        console.warn("[TJP Studio]: Frame capture error:", e);
        Alpine.store('previewLoading', false);
    }
}

worker.onmessage = function (event: MessageEvent<any>) {
    if (event.data.cmd === 'isSupported') {
        if (!event.data.data) return showUnsupported("WebGPU API");
    } else if (event.data.cmd === 'previewUpdated') {
        Alpine.store('previewLoading', false);
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
    const currentFamily = (Alpine.store('videoFamily') as VideoModelFamily) || 'detail';
    const profile: VideoProfilePreset = currentFamily === 'detail' ? 'photo' : 'text';

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
        engineMode: engineMode,
        profile: profile,
        family: currentFamily
    } as any);
}

// Seamlessly opens file picker when arriving from landing page trial button (0 memory freeze)
function checkAndLoadPendingTrialVideo(): void {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('trial') === '5s') {
        setTimeout(() => {
            if (Alpine.store('state') === 'init') {
                chooseFile();
            }
        }, 350);
    }
}

// ============================================================================
// IMAGE UPSCALER (ESRGAN DEEP ML ENGINE)
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
        Alpine.store('imageScale', 4);
        Alpine.store('imagePreset', 'ultra');

        await triggerInstantImageEnhance();
    } catch {
        Alpine.store('imageError', 'Failed to decode image file. Please use PNG, JPEG, or WebP.');
        Alpine.store('imageState', 'error');
    }
}

async function triggerInstantImageEnhance(): Promise<void> {
    if (!activeImageBitmap) return;

    Alpine.store('imageState', 'processing');
    Alpine.store('imageStatusTitle', 'Synthesizing Sub-Pixel Details');
    Alpine.store('imageProgressMessage', 'Applying ESRGAN neural reconstruction...');
    Alpine.store('imageProgress', 15);

    try {
        const scale = (Alpine.store('imageScale') as 2 | 4) || 4;
        const preset = (Alpine.store('imagePreset') as ImageModelPreset) || 'ultra';

        const upscaledBlob = await upscaleImage(activeImageBitmap, { 
            scale, 
            preset,
            onProgress: (stage, progress, details) => {
                Alpine.store('imageProgress', progress);
                if (details) Alpine.store('imageProgressMessage', details);
            }
        });

        if (currentUpscaledBlobUrl) {
            URL.revokeObjectURL(currentUpscaledBlobUrl);
        }

        currentUpscaledBlobUrl = URL.createObjectURL(upscaledBlob);
        Alpine.store('imageDownloadUrl', currentUpscaledBlobUrl);
        Alpine.store('imageState', 'preview');
    } catch (err: any) {
        Alpine.store('imageError', err?.message || 'ESRGAN Image Upscale failed.');
        Alpine.store('imageState', 'error');
    }
}

// ============================================================================
// 🎙️ AI AUDIO / VOICE ENHANCER
// ============================================================================

async function chooseAudioFile(e?: Event): Promise<void> {
    try {
        if (window.showOpenFilePicker) {
            const [fileHandle] = await window.showOpenFilePicker({
                types: [{
                    description: 'Audio or Video Files',
                    accept: {
                        'audio/*': ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac'],
                        'video/*': ['.mp4', '.mov', '.webm', '.mkv']
                    }
                }],
                multiple: false
            });
            const file = await fileHandle.getFile();
            await setupAudioFile(file);
        } else {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'audio/*, video/mp4, video/quicktime, video/webm, .mp4, .mov, .webm, .m4a, .mp3, .wav, .aac';
            input.onchange = async () => {
                if (input.files && input.files[0]) {
                    await setupAudioFile(input.files[0]);
                }
            };
            input.click();
        }
    } catch {
        console.log('Audio selection cancelled');
    }
}

async function setupAudioFile(file: File): Promise<void> {
    const mode = (Alpine.store('audioMode') as 'voice' | 'music') || 'voice';
    Alpine.store('audioState', 'processing');
    Alpine.store('audioFileName', file.name);
    const baseName = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
    const suffix = mode === 'music' ? '-TJP-MUSIC-MASTER.wav' : '-TJP-STUDIO-VOICE.wav';
    Alpine.store('audioDownloadName', baseName + suffix);

    try {
        const result = await enhanceAudioFile(file, { mode }, (progress, stage) => {
            Alpine.store('audioProgress', progress);
            Alpine.store('audioProgressMessage', stage);
        });

        const downloadUrl = URL.createObjectURL(result.blob);
        Alpine.store('audioDownloadUrl', downloadUrl);
        Alpine.store('audioDuration', formatTime(result.durationSec));
        Alpine.store('audioState', 'complete');
    } catch (err: any) {
        alert(err?.message || 'Audio enhancement failed');
        Alpine.store('audioState', 'init');
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