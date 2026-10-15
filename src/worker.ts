import WebSR from '@websr/websr';
import pipelineProcessor from './processors/pipeline-processor';
import type {
  InitData,
  Resolution,
  VideoProfilePreset
} from './types/worker-messages';

let gpu: any | false = false;
let websr: any = null;
let currentFamily: 'sharpen' | 'detail' = 'detail';
let currentTier: 'fast' | 'balanced' | 'quality' = 'balanced';
let currentNetwork: string = 'anime4k/cnn-2x-l';

let upscaled_canvas: OffscreenCanvas | null = null;
let original_canvas: OffscreenCanvas | null = null;
let resolution: Resolution = { width: 192, height: 192 };
let origCtx: any = null;
let pauseLock: Promise<void> | null = null;
let resolvePause: (() => void) | null = null;

// Verified local neural weights
const weightsRealLife = require('./weights/cnn-2x-l-rl.json');
const weightsAnime = require('./weights/cnn-2x-l-an.json');
const weightsFast = require('./weights/cnn-2x-s-an.json');

function getModelConfig(family: 'sharpen' | 'detail', tier: 'fast' | 'balanced' | 'quality'): { networkName: string; weights: any } {
  if (family === 'sharpen') {
    if (tier === 'fast') return { networkName: 'anime4k/cnn-2x-s', weights: weightsFast };
    return { networkName: 'anime4k/cnn-2x-l', weights: weightsAnime };
  } else {
    // Detail Mode: Photographic real-life texture weights
    if (tier === 'fast') return { networkName: 'anime4k/cnn-2x-s', weights: weightsRealLife };
    return { networkName: 'anime4k/cnn-2x-l', weights: weightsRealLife };
  }
}

async function isSupported(): Promise<void> {
  gpu = await WebSR.initWebGPU();
  (postMessage as any)({
    cmd: 'isSupported',
    data: gpu !== false
  });
}

async function renderFrame(bitmap: ImageBitmap, targetFamily: 'sharpen' | 'detail', targetTier: 'fast' | 'balanced' | 'quality'): Promise<void> {
  if (!gpu) {
    gpu = await WebSR.initWebGPU();
  }

  const pw = Math.floor(bitmap.width / 2) * 2;
  const ph = Math.floor(bitmap.height / 2) * 2;

  // 1. Draw Left Canvas: Raw pixels displayed with crisp nearest-neighbor (chunky blocks visible)
  if (original_canvas) {
    if (original_canvas.width !== pw * 2 || original_canvas.height !== ph * 2) {
      original_canvas.width = pw * 2;
      original_canvas.height = ph * 2;
    }
    if (!origCtx) {
      origCtx = original_canvas.getContext('2d');
    }
    if (origCtx) {
      origCtx.imageSmoothingEnabled = false;
      origCtx.drawImage(bitmap, 0, 0, pw * 2, ph * 2);
    }
  }

  // 2. Resolve model configuration
  const { networkName, weights } = getModelConfig(targetFamily, targetTier);
  const modelChanged = currentFamily !== targetFamily || currentTier !== targetTier;
  const sizeChanged = resolution.width !== pw || resolution.height !== ph;

  if (!websr) {
    if (upscaled_canvas) {
      upscaled_canvas.width = pw * 2;
      upscaled_canvas.height = ph * 2;
      resolution = { width: pw, height: ph };
      currentFamily = targetFamily;
      currentTier = targetTier;
      currentNetwork = networkName;

      try {
        websr = new WebSR({
          network_name: networkName as any,
          weights: weights,
          resolution: { width: pw, height: ph },
          gpu: gpu as any,
          canvas: upscaled_canvas as any
        });
        console.log(`[TJP Worker]: Initialized WebSR -> ${targetFamily.toUpperCase()} (${networkName})`);
      } catch (err) {
        console.error("[TJP Worker]: WebSR init error:", err);
      }
    }
  } else if (modelChanged || sizeChanged) {
    resolution = { width: pw, height: ph };
    currentFamily = targetFamily;
    currentTier = targetTier;
    currentNetwork = networkName;

    if (upscaled_canvas) {
      upscaled_canvas.width = pw * 2;
      upscaled_canvas.height = ph * 2;
    }

    try {
      if (typeof websr.switchNetwork === 'function') {
        websr.switchNetwork(networkName, weights);
        console.log(`[TJP Worker]: Switched network -> ${networkName}`);
      } else {
        websr.params.network_name = networkName;
        websr.params.weights = weights;
        websr.network = new (websr.constructor as any).NetworkList[networkName](weights);
      }
    } catch (e) {
      console.warn("[TJP Worker]: switchNetwork note:", e);
    }
  }

  // 3. Render Enhanced Output to Right Canvas & flush GPU queue
  if (websr && gpu) {
    try {
      await websr.render(bitmap as any);
      await gpu.queue.onSubmittedWorkDone();
      console.log(`[TJP Worker]: Frame rendered -> ${targetFamily.toUpperCase()} (${targetTier})`);
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

      const config: InitData = event.data.data;
      upscaled_canvas = config.upscaled;
      original_canvas = config.original;

      const family = (event.data.family as 'sharpen' | 'detail') || 'detail';
      const tier = (event.data.tier as 'fast' | 'balanced' | 'quality') || 'balanced';

      if (config.bitmap) {
        await renderFrame(config.bitmap, family, tier);
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

      await renderFrame(bitmap, family, tier);
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
        upscaled_canvas: upscaled_canvas || new OffscreenCanvas(360, 360),
        original_canvas: original_canvas || new OffscreenCanvas(360, 360),
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