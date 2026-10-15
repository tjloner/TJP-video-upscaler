import WebSR from '@websr/websr';
import pipelineProcessor from './processors/pipeline-processor';
import type {
  Resolution,
  VideoProfilePreset
} from './types/worker-messages';

let gpu: any | false = false;
let websr: any = null;
let currentFamily: 'sharpen' | 'detail' = 'detail';
let currentTier: 'fast' | 'balanced' | 'quality' = 'balanced';

let workerUpscaledCanvas: OffscreenCanvas | null = null;
let resolution: Resolution = { width: 360, height: 360 };
let pauseLock: Promise<void> | null = null;
let resolvePause: (() => void) | null = null;

// Bundled neural weights
const weightsRealLife = require('./weights/cnn-2x-l-rl.json');
const weightsAnime = require('./weights/cnn-2x-l-an.json');
const weightsFast = require('./weights/cnn-2x-s-an.json');

function getModelConfig(family: 'sharpen' | 'detail', tier: 'fast' | 'balanced' | 'quality'): { networkName: string; weights: any } {
  if (tier === 'fast') {
    return { networkName: 'anime4k/cnn-2x-s', weights: weightsFast };
  }
  if (family === 'sharpen') {
    return { networkName: 'anime4k/cnn-2x-l', weights: weightsAnime };
  }
  return { networkName: 'anime4k/cnn-2x-l', weights: weightsRealLife };
}

async function isSupported(): Promise<void> {
  gpu = await WebSR.initWebGPU();
  (postMessage as any)({
    cmd: 'isSupported',
    data: gpu !== false
  });
}

async function renderFrameToCanvases(bitmap: ImageBitmap, targetFamily: 'sharpen' | 'detail', targetTier: 'fast' | 'balanced' | 'quality'): Promise<void> {
  // Guarantee GPU initialized
  if (!gpu) {
    gpu = await WebSR.initWebGPU();
  }

  // Ensure dimensions are strictly even multiples of 2
  const pw = Math.floor(bitmap.width / 2) * 2;
  const ph = Math.floor(bitmap.height / 2) * 2;

  // 1. Raw original frame
  let rawBitmap: ImageBitmap;
  try {
    rawBitmap = await createImageBitmap(bitmap, {
      resizeWidth: pw * 2,
      resizeHeight: ph * 2,
      resizeQuality: 'pixelated' as any
    });
  } catch {
    rawBitmap = await createImageBitmap(bitmap, {
      resizeWidth: pw * 2,
      resizeHeight: ph * 2,
      resizeQuality: 'low'
    });
  }

  // 2. Resolve model configuration
  const { networkName, weights } = getModelConfig(targetFamily, targetTier);
  const configChanged = !websr || resolution.width !== pw || resolution.height !== ph || currentFamily !== targetFamily || currentTier !== targetTier;

  if (configChanged || !workerUpscaledCanvas) {
    resolution = { width: pw, height: ph };
    currentFamily = targetFamily;
    currentTier = targetTier;

    if (websr && typeof websr.destroy === 'function') {
      try { websr.destroy(); } catch (e) {}
      websr = null;
    }

    workerUpscaledCanvas = new OffscreenCanvas(pw * 2, ph * 2);

    try {
      websr = new WebSR({
        network_name: networkName as any,
        weights: weights,
        resolution: { width: pw, height: ph },
        gpu: gpu as any,
        canvas: workerUpscaledCanvas as any
      });
      console.log(`[TJP Worker]: Rebuilt WebGPU pipeline -> ${targetFamily.toUpperCase()} (${targetTier})`);
    } catch (err) {
      console.error("[TJP Worker]: WebSR reconstruction error:", err);
    }
  }

  // 3. Render Enhanced Output & Dispatch to UI
  if (websr && workerUpscaledCanvas) {
    try {
      await websr.render(bitmap as any);
      
      const upscaledBitmap = await createImageBitmap(workerUpscaledCanvas);

      (postMessage as any)({
        cmd: 'previewRendered',
        original: rawBitmap,
        upscaled: upscaledBitmap,
        width: pw * 2,
        height: ph * 2
      }, [rawBitmap, upscaledBitmap]);

      console.log(`[TJP Worker]: Fresh frame dispatched to UI (${targetFamily} - ${targetTier})`);
    } catch (e) {
      console.error("[TJP Worker]: Render pass error:", e);
    }
  }
}

self.onmessage = async function (event: MessageEvent<any>) {
  if (!event.data || !event.data.cmd) return;

  switch (event.data.cmd) {
    case 'init': {
      if (!gpu) {
        gpu = await WebSR.initWebGPU();
      }

      const family = (event.data.family as 'sharpen' | 'detail') || 'detail';
      const tier = (event.data.tier as 'fast' | 'balanced' | 'quality') || 'balanced';

      if (event.data.data.bitmap) {
        await renderFrameToCanvases(event.data.data.bitmap, family, tier);
        event.data.data.bitmap.close();
      }
      break;
    }

    case 'isSupported':
      await isSupported();
      break;

    case 'updatePreview': {
      const { bitmap } = event.data.data;
      if (!bitmap) break;

      const family = (event.data.family as 'sharpen' | 'detail') || currentFamily;
      const tier = (event.data.tier as 'fast' | 'balanced' | 'quality') || currentTier;

      await renderFrameToCanvases(bitmap, family, tier);
      bitmap.close();
      break;
    }

    case 'pause':
      if (!pauseLock) {
        pauseLock = new Promise(resolve => { resolvePause = resolve; });
        (postMessage as any)({ cmd: 'paused' });
      }
      break;

    case 'resume':
      if (pauseLock && resolvePause) {
        resolvePause();
        pauseLock = null;
        resolvePause = null;
        (postMessage as any)({ cmd: 'resumed' });
      }
      break;

    case 'process':
      await pipelineProcessor({
        inputHandle: event.data.inputHandle,
        outputHandle: event.data.outputHandle,
        websr: websr as any,
        upscaled_canvas: workerUpscaledCanvas || new OffscreenCanvas(360, 360),
        original_canvas: new OffscreenCanvas(360, 360),
        resolution,
        preset: event.data.preset,
        targetScale: event.data.targetScale,
        targetWidth: event.data.targetWidth,
        targetHeight: event.data.targetHeight,
        targetBitrate: event.data.targetBitrate,
        engineMode: event.data.engineMode || 'deep',
        profile: event.data.profile || 'photo',
        aiModel: event.data.aiModel,
        getPauseLock: () => pauseLock
      });
      break;
  }
};