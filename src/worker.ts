import WebSR from '@websr/websr';
import pipelineProcessor from './processors/pipeline-processor';
import type {
  InitData,
  Resolution
} from './types/worker-messages';

// Worker state
let gpu: any | false;
let websr: WebSR;
let upscaled_canvas: OffscreenCanvas;
let original_canvas: OffscreenCanvas;
let resolution: Resolution = { width: 640, height: 360 };
let ctx: any = null;
let pauseLock: Promise<void> | null = null;
let resolvePause: (() => void) | null = null;

// Default weights: Photographic model for realistic live-action fidelity
const weights = require('./weights/cnn-2x-l-rl.json');

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

  websr = new WebSR({
    network_name: "anime4k/cnn-2x-l",
    weights,
    resolution: resolution,
    gpu: gpu,
    canvas: config.upscaled as any
  });

  ctx = original_canvas.getContext('bitmaprenderer');

  try {
    const bitmap2 = await createImageBitmap(config.bitmap, {
      resizeHeight: resolution.height * 2,
      resizeWidth: resolution.width * 2,
    });
    await websr.render(config.bitmap as any);
    if (ctx) {
      ctx.transferFromImageBitmap(bitmap2);
    }
  } catch (e) {
    console.warn("Worker preview render note:", e);
  }
}

async function switchNetwork(name: string, networkWeights: any, bitmap: ImageBitmap): Promise<void> {
  if (websr) {
    websr.switchNetwork(name as any, networkWeights);
    await websr.render(bitmap as any);
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
      // Forward all dynamic Smart Resolution parameters
      await pipelineProcessor({
        inputHandle: event.data.inputHandle,
        outputHandle: event.data.outputHandle,
        websr,
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

    case 'network':
      await switchNetwork(
        event.data.data.name,
        event.data.data.weights,
        event.data.data.bitmap
      );
      break;

    case 'updatePreview':
      if (event.data.data?.resolution) {
        resolution = event.data.data.resolution;
      }
      if (websr && event.data.data?.bitmap) {
        try {
          await websr.render(event.data.data.bitmap as any);
        } catch {}
      }
      break;
  }
};