import Upscaler from 'upscaler';
import DefaultModel from '@upscalerjs/default-model';
import WebSR from '@websr/websr';

export type ImageModelPreset = 'photo' | 'portrait' | 'anime' | 'text' | 'ultra';

export interface ImageUpscaleOptions {
  scale: 2 | 4;
  preset: ImageModelPreset;
  onProgress?: (stage: string, progress: number, details?: string) => void;
}

let upscalerInstance: any = null;

function getUpscaler(): any {
  if (!upscalerInstance) {
    upscalerInstance = new Upscaler({
      model: DefaultModel,
    });
  }
  return upscalerInstance;
}

const photoWeights = require('../weights/cnn-2x-l-rl.json');
const animeWeights = require('../weights/cnn-2x-l-an.json');

const modelWeights: Record<string, any> = {
  photo: photoWeights,
  portrait: photoWeights,
  anime: animeWeights,
  text: animeWeights,
  ultra: photoWeights,
};

export async function upscaleImage(
  imageSource: ImageBitmap,
  options: ImageUpscaleOptions
): Promise<Blob> {
  const inWidth = imageSource.width;
  const inHeight = imageSource.height;
  const scale = options.scale;

  // =========================================================================
  // PATH A: DEEP GENERATIVE ESRGAN (For Photo, Portrait & Ultra)
  // =========================================================================
  if (options.preset === 'ultra' || options.preset === 'portrait' || options.preset === 'photo') {
    try {
      options.onProgress?.('processing', 15, 'Initializing ESRGAN Neural Core...');

      const upscaler = getUpscaler();

      // Convert ImageBitmap to an offscreen HTMLCanvasElement for tensor processing
      const inputCanvas = document.createElement('canvas');
      inputCanvas.width = inWidth;
      inputCanvas.height = inHeight;
      const inCtx = inputCanvas.getContext('2d')!;
      inCtx.drawImage(imageSource, 0, 0);

      options.onProgress?.('processing', 35, 'Synthesizing Sub-Pixel Facial Details (ESRGAN)...');

      // Run tiled generative super-resolution
      const upscaledSrc = await upscaler.upscale(inputCanvas, {
        output: 'base64',
        patchSize: 128,
        padding: 8,
        progress: (amount: number) => {
          const pct = Math.round(35 + amount * 55);
          options.onProgress?.('processing', pct, `Synthesizing Neural Details: ${Math.round(amount * 100)}%`);
        }
      });

      options.onProgress?.('processing', 95, 'Finalizing Ultra-Resolution Render...');

      // Convert the base64 output into a high-res PNG Blob
      const response = await fetch(upscaledSrc);
      return await response.blob();
    } catch (err) {
      console.warn("ESRGAN engine notice, falling back to WebGPU shader:", err);
      // Fall through cleanly to WebGPU pipeline if device memory is constrained
    }
  }

  // =========================================================================
  // PATH B: WEBGPU LINE-THINNING PIPELINE (For Anime & Text / Logos)
  // =========================================================================
  const gpu = await WebSR.initWebGPU();
  if (!gpu) {
    throw new Error("WebGPU is not supported or hardware acceleration is disabled.");
  }

  const selectedWeights = modelWeights[options.preset] || animeWeights;
  const networkName = "anime4k/cnn-2x-l";

  const pass1Width = inWidth * 2;
  const pass1Height = inHeight * 2;
  const canvasPass1 = new OffscreenCanvas(pass1Width, pass1Height);

  const websrPass1 = new WebSR({
    network_name: networkName as any,
    weights: selectedWeights,
    resolution: { width: inWidth, height: inHeight },
    gpu: gpu,
    canvas: canvasPass1 as any,
  });

  await websrPass1.render(imageSource as any);

  const targetWidth = inWidth * scale;
  const targetHeight = inHeight * scale;

  const finalCanvas = new OffscreenCanvas(targetWidth, targetHeight);
  const finalCtx = finalCanvas.getContext('2d', { willReadFrequently: true });
  if (!finalCtx) throw new Error("Canvas context creation failed");

  finalCtx.imageSmoothingEnabled = true;
  finalCtx.imageSmoothingQuality = 'high';

  const pass1Bitmap = await createImageBitmap(canvasPass1);
  finalCtx.drawImage(pass1Bitmap, 0, 0, targetWidth, targetHeight);
  pass1Bitmap.close();

  applyStructuralSharpening(finalCtx, targetWidth, targetHeight, options.preset, scale);

  if (typeof (finalCanvas as any).convertToBlob === 'function') {
    return await (finalCanvas as any).convertToBlob({ type: 'image/png' });
  }

  const exportBitmap = await createImageBitmap(finalCanvas);
  const fallbackCanvas = document.createElement('canvas');
  fallbackCanvas.width = targetWidth;
  fallbackCanvas.height = targetHeight;
  const ctx = fallbackCanvas.getContext('2d');
  ctx?.drawImage(exportBitmap, 0, 0);
  exportBitmap.close();

  return await new Promise<Blob>((resolve, reject) => {
    fallbackCanvas.toBlob((b) => {
      if (b) resolve(b);
      else reject(new Error("Image conversion failed"));
    }, 'image/png');
  });
}

function applyStructuralSharpening(
  ctx: OffscreenCanvasRenderingContext2D,
  w: number,
  h: number,
  preset: ImageModelPreset,
  scale: 2 | 4
): void {
  try {
    const imgData = ctx.getImageData(0, 0, w, h);
    const d = imgData.data;
    const copy = new Uint8ClampedArray(d);

    const gain = preset === 'text' ? 0.75 : (preset === 'anime' ? 0.60 : 0.35);

    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const idx = (y * w + x) * 4;

        const lumaC = 0.299 * copy[idx] + 0.587 * copy[idx + 1] + 0.114 * copy[idx + 2];
        const idxN = ((y - 1) * w + x) * 4;
        const idxS = ((y + 1) * w + x) * 4;
        const idxW = (y * w + (x - 1)) * 4;
        const idxE = (y * w + (x + 1)) * 4;

        const lumaN = 0.299 * copy[idxN] + 0.587 * copy[idxN + 1] + 0.114 * copy[idxN + 2];
        const lumaS = 0.299 * copy[idxS] + 0.587 * copy[idxS + 1] + 0.114 * copy[idxS + 2];
        const lumaW = 0.299 * copy[idxW] + 0.587 * copy[idxW + 1] + 0.114 * copy[idxW + 2];
        const lumaE = 0.299 * copy[idxE] + 0.587 * copy[idxE + 1] + 0.114 * copy[idxE + 2];

        const lap = 4 * lumaC - (lumaN + lumaS + lumaW + lumaE);

        if (Math.abs(lap) > 5) {
          const delta = Math.max(-50, Math.min(50, lap * gain));
          d[idx] = Math.min(255, Math.max(0, copy[idx] + delta));
          d[idx + 1] = Math.min(255, Math.max(0, copy[idx + 1] + delta));
          d[idx + 2] = Math.min(255, Math.max(0, copy[idx + 2] + delta));
        }
      }
    }

    ctx.putImageData(imgData, 0, 0);
  } catch (e) {
    console.warn("Sharpening note:", e);
  }
}