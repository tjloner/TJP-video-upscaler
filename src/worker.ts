import WebSR from '@websr/websr';
import pipelineProcessor from './processors/pipeline-processor';
import type {
  InitData,
  Resolution,
  VideoProfilePreset
} from './types/worker-messages';

let gpu: any | false;
let websr: WebSR | null = null;
let currentProfile: VideoProfilePreset = 'photo';
let upscaled_canvas: OffscreenCanvas;
let original_canvas: OffscreenCanvas;
let resolution: Resolution = { width: 640, height: 360 };
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

  resolution = config.resolution || { width: 640, height: 360 };
  currentProfile = config.profile || 'photo';
  upscaled_canvas = config.upscaled;
  original_canvas = config.original;
  origCtx = original_canvas.getContext('bitmaprenderer');

  const modelWeights = resolvePreviewWeights(currentProfile);

  try {
    websr = new WebSR({
      network_name: "anime4k/cnn-2x-l",
      weights: modelWeights,
      resolution: resolution,
      gpu: gpu as any,
      canvas: config.upscaled as any
    });

    // 1. Paint Left Canvas (Original Raw Low-Res Frame)
    if (origCtx && config.bitmap) {
      const origBitmap = await createImageBitmap(config.bitmap, {
        resizeWidth: resolution.width * 2,
        resizeHeight: resolution.height * 2,
        resizeQuality: 'low'
      });
      origCtx.transferFromImageBitmap(origBitmap);
    }

    // 2. Paint Right Canvas (Adaptive WebGPU Neural Upscale)
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

      const w = bitmap.width;
      const h = bitmap.height;
      const nextProfile = profile || currentProfile;

      const needsReinit = !websr || resolution.width !== w || resolution.height !== h || currentProfile !== nextProfile;

      if (needsReinit) {
        resolution = { width: w, height: h };
        currentProfile = nextProfile;
        if (gpu && upscaled_canvas) {
          try {
            websr = new WebSR({
              network_name: "anime4k/cnn-2x-l",
              weights: resolvePreviewWeights(currentProfile),
              resolution: { width: w, height: h },
              gpu: gpu as any,
              canvas: upscaled_canvas as any
            });
          } catch (err) {
            console.warn("WebSR preview profile reconfig note:", err);
          }
        }
      }

      if (origCtx) {
        try {
          const rawLowRes = await createImageBitmap(bitmap, {
            resizeWidth: w * 2,
            resizeHeight: h * 2,
            resizeQuality: 'low'
          });
          origCtx.transferFromImageBitmap(rawLowRes);
        } catch (e) {
          console.warn("Left canvas transfer note:", e);
        }
      }

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