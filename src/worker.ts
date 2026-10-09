import WebSR from '@websr/websr';
import pipelineProcessor from './processors/pipeline-processor';
import type {
  InitData,
  Resolution
} from './types/worker-messages';

let gpu: any | false;
let websr: WebSR | null = null;
let upscaled_canvas: OffscreenCanvas;
let original_canvas: OffscreenCanvas;
let resolution: Resolution = { width: 640, height: 360 };
let origCtx: any = null;
let pauseLock: Promise<void> | null = null;
let resolvePause: (() => void) | null = null;

const weights = require('./weights/cnn-2x-l-an.json');

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
  upscaled_canvas = config.upscaled;
  original_canvas = config.original;
  origCtx = original_canvas.getContext('bitmaprenderer');

  try {
    websr = new WebSR({
      network_name: "anime4k/cnn-2x-l",
      weights,
      resolution: resolution,
      gpu: gpu as any,
      canvas: config.upscaled as any
    });
  } catch (e) {
    console.warn("WebSR initialization note:", e);
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
        getPauseLock: () => pauseLock
      });
      break;

    // SYNCHRONIZED PREVIEW: Guarantees left and right show the exact same frame
    case 'updatePreview': {
      const { bitmap } = event.data.data;
      if (!bitmap) break;

      const w = bitmap.width;
      const h = bitmap.height;

      // Reconfigure WebSR if zoom or resolution changed
      if (!websr || resolution.width !== w || resolution.height !== h) {
        resolution = { width: w, height: h };
        if (gpu && upscaled_canvas) {
          try {
            websr = new WebSR({
              network_name: "anime4k/cnn-2x-l",
              weights,
              resolution: { width: w, height: h },
              gpu: gpu as any,
              canvas: upscaled_canvas as any
            });
          } catch (err) {
            console.warn("WebSR reconfig:", err);
          }
        }
      }

      // 1. Paint LEFT canvas with raw original frame (scaled 2x with pixelated quality so pixels match)
      if (origCtx) {
        try {
          const orig2x = await createImageBitmap(bitmap, {
            resizeWidth: w * 2,
            resizeHeight: h * 2,
            resizeQuality: 'pixelated'
          });
          origCtx.transferFromImageBitmap(orig2x);
        } catch (e) {
          console.warn("Left canvas render error:", e);
        }
      }

      // 2. Paint RIGHT canvas with neural enhanced frame
      if (websr) {
        try {
          await websr.render(bitmap as any);
        } catch (e) {
          console.warn("Right canvas render error:", e);
        }
      }

      bitmap.close();
      break;
    }
  }
};