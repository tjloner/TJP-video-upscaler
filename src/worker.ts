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
let upscaled_canvas: OffscreenCanvas;
let original_canvas: OffscreenCanvas;
let resolution: Resolution = { width: 360, height: 360 };
let origCtx: any = null;
let pauseLock: Promise<void> | null = null;
let resolvePause: (() => void) | null = null;

const weightBuffers: Record<string, any> = {};

function getBaseUrl(): string {
  if (typeof self !== 'undefined' && self.location && self.location.href) {
    const href = self.location.href;
    const idx = href.indexOf('/dist/') !== -1 ? href.indexOf('/dist/') : href.lastIndexOf('/');
    return href.substring(0, idx + 1);
  }
  return '/';
}

function parseWeightsBinary(buffer: ArrayBuffer): any {
  const view = new DataView(buffer);
  const m0 = view.getUint8(0);
  const m1 = view.getUint8(1);
  const m2 = view.getUint8(2);
  const m3 = view.getUint8(3);

  // UNT\0 (U-Net)
  if (m0 === 85 && m1 === 78 && m2 === 84 && m3 === 0) {
    if (typeof (WebSR as any).parseUNetWeights === 'function') {
      return (WebSR as any).parseUNetWeights(buffer);
    }
    return { format: 'unet', buffer };
  }

  // A4K\0 (Anime4K CNN)
  if (m0 === 65 && m1 === 52 && m2 === 75 && m3 === 0) {
    if (typeof (WebSR as any).parseBinaryWeights === 'function') {
      return (WebSR as any).parseBinaryWeights(buffer);
    }
  }

  return buffer;
}

async function resolveModelWeights(family: 'sharpen' | 'detail', tier: 'fast' | 'balanced' | 'quality'): Promise<{ networkName: string; weights: any }> {
  let fileName = 'unet-u24.bin';
  let networkName = 'katana/unet-u24';

  if (family === 'sharpen') {
    if (tier === 'fast') {
      fileName = 'cnn-8.bin';
      networkName = 'anime4k/cnn-2x-l';
    } else if (tier === 'quality') {
      fileName = 'cnn-28.bin';
      networkName = 'anime4k/cnn-2x-28';
    } else {
      fileName = 'cnn-16.bin';
      networkName = 'anime4k/cnn-2x-16';
    }
  }

  if (weightBuffers[fileName]) {
    return { networkName, weights: weightBuffers[fileName] };
  }

  const baseUrl = getBaseUrl();
  const url = `${baseUrl}weights/${fileName}`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    const parsed = parseWeightsBinary(buf);
    weightBuffers[fileName] = parsed;
    console.log(`[TJP Worker]: Loaded binary weights from ${url}`);
    return { networkName, weights: parsed };
  } catch (err) {
    console.warn(`[TJP Worker]: Could not fetch ${url}, using bundled fallback:`, err);
    // Bundled fallback guarantees the engine NEVER crashes into a blank screen
    const fallback = family === 'detail'
      ? require('./weights/cnn-2x-l-rl.json')
      : require('./weights/cnn-2x-l-an.json');
    return { networkName: 'anime4k/cnn-2x-l', weights: fallback };
  }
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

  // 2. Resolve AI Model
  const { networkName, weights } = await resolveModelWeights(targetFamily, targetTier);

  // Initialize or reconfigure WebSR instance safely
  if (!websr || resolution.width !== pw || resolution.height !== ph || currentFamily !== targetFamily || currentTier !== targetTier) {
    resolution = { width: pw, height: ph };
    currentFamily = targetFamily;
    currentTier = targetTier;

    if (gpu && upscaled_canvas) {
      try {
        websr = new WebSR({
          network_name: networkName as any,
          weights: weights,
          resolution: { width: pw, height: ph },
          gpu: gpu as any,
          canvas: upscaled_canvas as any
        });
      } catch (e) {
        console.warn("[TJP Worker]: WebSR network init failed, falling back to baseline network:", e);
        try {
          websr = new WebSR({
            network_name: 'anime4k/cnn-2x-l' as any,
            weights: require('./weights/cnn-2x-l-rl.json'),
            resolution: { width: pw, height: ph },
            gpu: gpu as any,
            canvas: upscaled_canvas as any
          });
        } catch (err) {
          console.error("[TJP Worker]: Critical WebSR init failure:", err);
        }
      }
    }
  }

  // 3. Paint Right Canvas (Enhanced WebGPU Neural Pass)
  if (websr) {
    try {
      await websr.render(bitmap as any);
    } catch (e) {
      console.warn("[TJP Worker]: Render pass error:", e);
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