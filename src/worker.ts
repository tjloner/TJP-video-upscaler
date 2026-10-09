import WebSR from '@websr/websr';
import pipelineProcessor from './processors/pipeline-processor';
import type {
  InitData,
  Resolution
} from './types/worker-messages';

let gpu: any | false;
let websr: WebSR;
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

  websr = new WebSR({
    network_name: "anime4k/cnn-2x-l",
    weights,
    resolution: resolution,
    gpu: gpu as any,
    canvas: config.upscaled as any
  });
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

    // SYNCHRONIZED DUAL-CANVAS PREVIEW UPDATE
    case 'updatePreview': {
      const { origBitmap, upscaledBitmap, res } = event.data.data;
      if (res) resolution = res;

      // 1. Paint Left Side (Raw Original)
      if (origCtx && origBitmap) {
        try {
          origCtx.transferFromImageBitmap(origBitmap);
        } catch (e) {
          console.warn("origCtx transfer note:", e);
        }
      }

      // 2. Render Right Side through WebGPU (Neural Enhanced)
      if (websr && upscaledBitmap) {
        try {
          await websr.render(upscaledBitmap as any);
        } catch (e) {
          console.warn("websr render note:", e);
        }
      }
      break;
    }
  }
};