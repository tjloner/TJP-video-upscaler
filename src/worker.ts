import WebSR from '@websr/websr';
import pipelineProcessor from './processors/pipeline-processor';
import type {
  InitData,
  Resolution,
  VideoProfilePreset
} from './types/worker-messages';

let gpu: any | false = false;
let websr: any = null;
let currentNetwork = 'katana/unet-u24';
let currentWeights: any = null;
let upscaled_canvas: OffscreenCanvas;
let original_canvas: OffscreenCanvas;
let resolution: Resolution = { width: 360, height: 360 };
let origCtx: any = null;
let pauseLock: Promise<void> | null = null;
let resolvePause: (() => void) | null = null;

// Weight binary cache
const weightBuffers: Record<string, any> = {};

/**
 * Parses binary weight files (A4K\0 and UNT\0)
 */
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

/**
 * Loads authentic binary weights on demand
 */
async function loadWeightsForModel(family: 'sharpen' | 'detail', tier: 'fast' | 'balanced' | 'quality' = 'balanced'): Promise<{ networkName: string; weights: any }> {
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
  } else {
    fileName = 'unet-u24.bin';
    networkName = 'katana/unet-u24';
  }

  if (weightBuffers[fileName]) {
    return { networkName, weights: weightBuffers[fileName] };
  }

  try {
    const res = await fetch(`./weights/${fileName}`);
    if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
    const buf = await res.arrayBuffer();
    const parsed = parseWeightsBinary(buf);
    weightBuffers[fileName] = parsed;
    return { networkName, weights: parsed };
  } catch (err) {
    console.warn(`Failed loading local ./weights/${fileName}, falling back to bundled weights:`, err);
    // Fallback to bundled JSON weights if binary isn't reached
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

async function init(config: InitData): Promise<void> {
  if (!gpu) {
    gpu = await WebSR.initWebGPU();
  }

  const pw = config.bitmap ? config.bitmap.width : (config.resolution?.width || 360);
  const ph = config.bitmap ? config.bitmap.height : (config.resolution?.height || 360);
  resolution = { width: pw, height: ph };

  upscaled_canvas = config.upscaled;
  original_canvas = config.original;

  upscaled_canvas.width = pw * 2;
  upscaled_canvas.height = ph * 2;
  original_canvas.width = pw * 2;
  original_canvas.height = ph * 2;

  origCtx = original_canvas.getContext('2d');

  const { networkName, weights } = await loadWeightsForModel('detail', 'balanced');
  currentNetwork = networkName;
  currentWeights = weights;

  try {
    websr = new WebSR({
      network_name: currentNetwork as any,
      weights: currentWeights,
      resolution: { width: pw, height: ph },
      gpu: gpu as any,
      canvas: config.upscaled as any
    });

    // 1. Render Left Canvas: Raw patch with crisp nearest-neighbor display
    if (origCtx && config.bitmap) {
      origCtx.imageSmoothingEnabled = false;
      origCtx.drawImage(config.bitmap, 0, 0, pw * 2, ph * 2);
    }

    // 2. Render Right Canvas: True U-Net Neural Pass on identical patch
    if (websr && config.bitmap) {
      await websr.render(config.bitmap as any);
    }
  } catch (e) {
    console.warn("Worker init render note:", e);
  }
}

self.onmessage = async function (event: MessageEvent<any>) {
  if (!event.data || !event.data.cmd) return;

  switch (event.data.cmd) {
    case 'init':
      await init(event.data.data);
      break;

    case 'isSupported':
      await isSupported();
      break;

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

    case 'updatePreview': {
      const { bitmap, profile } = event.data.data;
      if (!bitmap) break;

      const pw = bitmap.width;
      const ph = bitmap.height;

      const isSharpen = profile === 'text';
      const targetFamily: 'sharpen' | 'detail' = isSharpen ? 'sharpen' : 'detail';
      const { networkName, weights } = await loadWeightsForModel(targetFamily, 'balanced');

      const needsReinit = !websr || resolution.width !== pw || resolution.height !== ph || currentNetwork !== networkName;

      if (needsReinit) {
        resolution = { width: pw, height: ph };
        currentNetwork = networkName;
        currentWeights = weights;

        if (upscaled_canvas && original_canvas) {
          upscaled_canvas.width = pw * 2;
          upscaled_canvas.height = ph * 2;
          original_canvas.width = pw * 2;
          original_canvas.height = ph * 2;
        }

        if (gpu && upscaled_canvas) {
          try {
            websr = new WebSR({
              network_name: currentNetwork as any,
              weights: currentWeights,
              resolution: { width: pw, height: ph },
              gpu: gpu as any,
              canvas: upscaled_canvas as any
            });
          } catch (err) {
            console.warn("WebSR preview reconfig note:", err);
          }
        }
      }

      // Draw Left Canvas (Identical patch crop, crisp raw pixels)
      if (origCtx) {
        try {
          origCtx.imageSmoothingEnabled = false;
          origCtx.drawImage(bitmap, 0, 0, pw * 2, ph * 2);
        } catch (e) {
          console.warn("Left canvas draw note:", e);
        }
      }

      // Draw Right Canvas (True U-Net / Deep CNN reconstructed patch)
      if (websr) {
        try {
          await websr.render(bitmap as any);
        } catch (e) {
          console.warn("Right canvas neural pass note:", e);
        }
      }

      bitmap.close();
      break;
    }
  }
};