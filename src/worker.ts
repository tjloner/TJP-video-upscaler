import WebSR from '@websr/websr';
import pipelineProcessor from './processors/pipeline-processor';
import type {
  InitData,
  Resolution,
  VideoProfilePreset
} from './types/worker-messages';

let gpu: any | false;
let websr: any = null;
let currentProfile: VideoProfilePreset = 'photo';
let upscaled_canvas: OffscreenCanvas;
let original_canvas: OffscreenCanvas;
let resolution: Resolution = { width: 360, height: 360 };
let origCtx: any = null;
let pauseLock: Promise<void> | null = null;
let resolvePause: (() => void) | null = null;

function resolvePreviewWeights(profile: VideoProfilePreset = 'photo'): any {
  if (profile === 'photo' || profile === 'portrait') {
    try {
      return require('./weights/cnn-2x-l-rl.json');
    } catch {
      return require('./weights/cnn-2x-l-an.json');
    }
  }
  return require('./weights/cnn-2x-l-an.json');
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

  currentProfile = config.profile || 'photo';
  upscaled_canvas = config.upscaled;
  original_canvas = config.original;

  // Align canvas pixel coordinate buffers strictly to 2x patch dimensions
  upscaled_canvas.width = pw * 2;
  upscaled_canvas.height = ph * 2;
  original_canvas.width = pw * 2;
  original_canvas.height = ph * 2;

  origCtx = original_canvas.getContext('2d');

  const modelWeights = resolvePreviewWeights(currentProfile);

  try {
    websr = new WebSR({
      network_name: "anime4k/cnn-2x-l",
      weights: modelWeights,
      resolution: { width: pw, height: ph },
      gpu: gpu as any,
      canvas: config.upscaled as any
    });

    // 1. Paint Left Canvas: Raw untouched patch with nearest-neighbor scaling
    if (origCtx && config.bitmap) {
      origCtx.imageSmoothingEnabled = false;
      origCtx.drawImage(config.bitmap, 0, 0, pw * 2, ph * 2);
    }

    // 2. Paint Right Canvas: WebGPU Neural Pass on the exact same patch
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
        profile: event.data.profile || currentProfile,
        aiModel: event.data.aiModel,
        getPauseLock: () => pauseLock
      });
      break;

    case 'updatePreview': {
      const { bitmap, profile } = event.data.data;
      if (!bitmap) break;

      const pw = bitmap.width;
      const ph = bitmap.height;
      const nextProfile = profile || currentProfile;

      const needsReinit = !websr || resolution.width !== pw || resolution.height !== ph || currentProfile !== nextProfile;

      if (needsReinit) {
        resolution = { width: pw, height: ph };
        currentProfile = nextProfile;

        if (upscaled_canvas && original_canvas) {
          upscaled_canvas.width = pw * 2;
          upscaled_canvas.height = ph * 2;
          original_canvas.width = pw * 2;
          original_canvas.height = ph * 2;
        }

        if (gpu && upscaled_canvas) {
          try {
            websr = new WebSR({
              network_name: "anime4k/cnn-2x-l",
              weights: resolvePreviewWeights(currentProfile),
              resolution: { width: pw, height: ph },
              gpu: gpu as any,
              canvas: upscaled_canvas as any
            });
          } catch (err) {
            console.warn("WebSR preview reconfig note:", err);
          }
        }
      }

      // Draw Left: Exactly the same patch coordinates
      if (origCtx) {
        try {
          origCtx.imageSmoothingEnabled = false;
          origCtx.drawImage(bitmap, 0, 0, pw * 2, ph * 2);
        } catch (e) {
          console.warn("Left canvas draw note:", e);
        }
      }

      // Draw Right: Exactly the same patch coordinates
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