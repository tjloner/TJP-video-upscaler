import WebSR from './lib/websr-custom';
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
let currentNetwork: string = 'katana/unet-u24';

let upscaled_canvas: OffscreenCanvas | null = null;
let original_canvas: OffscreenCanvas | null = null;
let resolution: Resolution = { width: 192, height: 192 };
let origCtx: any = null;
let pauseLock: Promise<void> | null = null;
let resolvePause: (() => void) | null = null;

const weightBuffers: Record<string, any> = {};

function parseBinaryWeights(buffer: ArrayBuffer): any {
  const bytes = new Uint8Array(buffer);
  const r = bytes[0], o = bytes[1], a = bytes[2], s = bytes[3];

  // A4K\0 (Anime4K CNN: 65, 52, 75, 0)
  if (r === 65 && o === 52 && a === 75 && s === 0) {
    const view = new DataView(buffer);
    let offset = 4;
    offset += 4; // skip version
    const layerCount = view.getUint32(offset, true);
    offset += 4;
    const layers: Record<string, any> = {};
    const decoder = new TextDecoder();

    for (let i = 0; i < layerCount; i++) {
      const nameLen = view.getUint32(offset, true);
      offset += 4;
      const name = decoder.decode(new Uint8Array(buffer, offset, nameLen));
      offset += nameLen;
      const weightCount = view.getUint32(offset, true);
      offset += 4;
      const biasCount = view.getUint32(offset, true);
      offset += 4;
      const weights = new Float32Array(buffer.slice(offset, offset + 4 * weightCount));
      offset += 4 * weightCount;
      const bias = new Float32Array(buffer.slice(offset, offset + 4 * biasCount));
      offset += 4 * biasCount;
      layers[name] = { weights, bias };
    }
    return { name: "", layers };
  }

  // UNT\0 (U-Net: 85, 78, 84, 0)
  if (r === 85 && o === 78 && a === 84 && s === 0) {
    return (WebSR as any).parseUNetWeights(buffer);
  }

  throw new Error("Invalid binary weight file");
}

async function loadModelWeights(family: 'sharpen' | 'detail', tier: 'fast' | 'balanced' | 'quality'): Promise<{ networkName: string; weights: any }> {
  let fileName = 'unet-u24.bin';
  let networkName = 'katana/unet-u24';

  if (family === 'sharpen') {
    // Avoid cnn-28 buffer allocation overflow which blanks the right side
    if (tier === 'fast') {
      fileName = 'cnn-8.bin';
      networkName = 'anime4k/cnn-2x-l';
    } else {
      fileName = 'cnn-16.bin';
      networkName = 'anime4k/cnn-2x-16';
    }
  } else {
    fileName = 'unet-u24.bin';
    networkName = 'katana/unet-u24';
  }

  if (weightBuffers[fileName]) {
    return { networkName, weights: weightBuffers[fileName] };
  }

  try {
    const res = await fetch(`./weights/${fileName}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    const parsed = parseBinaryWeights(buf);
    weightBuffers[fileName] = parsed;
    return { networkName, weights: parsed };
  } catch (err) {
    console.warn(`[TJP Engine]: Fallback for ${fileName}:`, err);
    return {
      networkName: 'anime4k/cnn-2x-l',
      weights: family === 'detail' ? require('./weights/cnn-2x-l-rl.json') : require('./weights/cnn-2x-l-an.json')
    };
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

  // 1. Draw Left Canvas: Raw pixels
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

  // 2. Resolve Model Configuration
  const { networkName, weights } = await loadModelWeights(targetFamily, targetTier);
  const modelChanged = currentFamily !== targetFamily || currentTier !== targetTier || currentNetwork !== networkName;
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
      } catch (err) {
        console.error("[TJP Engine]: WebSR init error:", err);
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
      websr.switchNetwork(networkName, weights);
    } catch (e) {
      console.warn("[TJP Engine]: switchNetwork note:", e);
    }
  }

  // 3. Render Enhanced Output to Right Canvas with GPU flush
  if (websr && gpu) {
    try {
      await websr.render(bitmap as any);
      await gpu.queue.onSubmittedWorkDone();
    } catch (e) {
      console.error("[TJP Engine]: Render pass error:", e);
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