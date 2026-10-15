import WebSR from '@websr/websr';
import pipelineProcessor from './processors/pipeline-processor';
import type {
  InitData,
  Resolution,
  VideoProfilePreset
} from './types/worker-messages';

let gpu: any | false = false;
let websr: any = null;
let currentNetwork = 'anime4k/cnn-2x-l';
let currentFamily: 'sharpen' | 'detail' = 'detail';
let currentTier: 'fast' | 'balanced' | 'quality' = 'balanced';
let upscaled_canvas: OffscreenCanvas;
let original_canvas: OffscreenCanvas;
let resolution: Resolution = { width: 360, height: 360 };
let origCtx: any = null;
let pauseLock: Promise<void> | null = null;
let resolvePause: (() => void) | null = null;

// Bundled verified neural weights
const weightsRealLife = require('./weights/cnn-2x-l-rl.json');
const weightsAnime = require('./weights/cnn-2x-l-an.json');
const weightsFast = require('./weights/cnn-2x-s-an.json');

function resolveModelConfig(family: 'sharpen' | 'detail', tier: 'fast' | 'balanced' | 'quality'): { networkName: string; weights: any } {
  if (tier === 'fast') {
    return { networkName: 'anime4k/cnn-2x-s', weights: weightsFast };
  }
  if (family === 'sharpen') {
    return { networkName: 'anime4k/cnn-2x-l', weights: weightsAnime };
  }
  // Detail mode uses real-life photographic weights
  return { networkName: 'anime4k/cnn-2x-l', weights: weightsRealLife };
}

async function isSupported(): Promise<void> {
  gpu = await WebSR.initWebGPU();
  postMessage({
    cmd: 'isSupported',
    data: gpu !== false
  } as any);
}

async function renderFrameToCanvases(bitmap: ImageBitmap, targetFamily: 'sharpen' | 'detail', targetTier: 'fast' | 'balanced' | 'quality'): Promise<void> {
  const pw = bitmap.width;
  const ph = bitmap.height;

  if (upscaled_canvas && original_canvas) {
    if (upscaled_canvas.width !== pw * 2 || upscaled_canvas.height !== ph * 2) {
      upscaled_canvas.width = pw * 2;
      upscaled_canvas.height = ph * 2;
      original_canvas.width = pw * 2;
      original_canvas.height = ph * 2;
    }
  }

  if (!origCtx && original_canvas) {
    origCtx = original_canvas.getContext('2d');
  }

  // 1. Paint Left Canvas (Original Raw: nearest-neighbor, authentic pixel inspection)
  if (origCtx) {
    origCtx.imageSmoothingEnabled = false;
    origCtx.drawImage(bitmap, 0, 0, pw * 2, ph * 2);
  }

  // 2. Resolve AI Model Config
  const { networkName, weights } = resolveModelConfig(targetFamily, targetTier);

  // Initialize or reconfigure WebSR instance safely
  const needsReconfig = !websr || resolution.width !== pw || resolution.height !== ph || currentFamily !== targetFamily || currentTier !== targetTier;

  if (needsReconfig) {
    resolution = { width: pw, height: ph };
    currentFamily = targetFamily;
    currentTier = targetTier;
    currentNetwork = networkName;

    if (gpu && upscaled_canvas) {
      try {
        websr = new WebSR({
          network_name: networkName as any,
          weights: weights,
          resolution: { width: pw, height: ph },
          gpu: gpu as any,
          canvas: upscaled_canvas as any
        });
        console.log(`[TJP Worker]: Configured ${targetFamily.toUpperCase()} mode (${networkName})`);
      } catch (err) {
        console.warn("[TJP Worker]: WebSR init note:", err);
      }
    }
  }

  // 3. Paint Right Canvas (Enhanced WebGPU Neural Pass)
  if (websr) {
    try {
      await websr.render(bitmap as any);
    } catch (e) {
      console.warn("[TJP Worker]: Render pass note:", e);
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

      const config: InitData = event.data.data;
      upscaled_canvas = config.upscaled;
      original_canvas = config.original;

      const family = (event.data.family as 'sharpen' | 'detail') || 'detail';
      const tier = (event.data.tier as 'fast' | 'balanced' | 'quality') || 'balanced';

      if (config.bitmap) {
        await renderFrameToCanvases(config.bitmap, family, tier);
        config.bitmap.close();
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
        postMessage({ cmd: 'paused' } as any);
      }
      break;

    case 'resume':
      if (pauseLock && resolvePause) {
        resolvePause();
        pauseLock = null;
        resolvePause = null;
        postMessage({ cmd: 'resumed' } as any);
      }
      break;

    case 'process':
      await pipelineProcessor({
        inputHandle: event.data.inputHandle,
        outputHandle: event.data.outputHandle,
        websr: websr as any,
        upscaled_canvas,
        original_canvas,
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