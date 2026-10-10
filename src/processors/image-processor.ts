import WebSR from '@websr/websr';

export type ImageModelPreset = 'photo' | 'portrait' | 'anime' | 'text';

export interface ImageUpscaleOptions {
  scale: 2 | 4;
  preset: ImageModelPreset;
}

const photoWeights = require('../weights/cnn-2x-l-rl.json');
const animeWeights = require('../weights/cnn-2x-l-an.json');

const modelWeights: Record<ImageModelPreset, any> = {
  photo: photoWeights,
  portrait: photoWeights,
  anime: animeWeights,
  text: animeWeights,
};

export async function upscaleImage(
  imageSource: ImageBitmap,
  options: ImageUpscaleOptions
): Promise<Blob> {
  const inWidth = imageSource.width;
  const inHeight = imageSource.height;
  const scale = options.scale;

  const gpu = await WebSR.initWebGPU();
  if (!gpu) {
    throw new Error("WebGPU is not supported or hardware acceleration is disabled.");
  }

  const selectedWeights = modelWeights[options.preset] || animeWeights;
  const networkName = "anime4k/cnn-2x-l";

  // Stage 1: Native WebSR Neural Inference (2x)
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

  // Stage 2: Target Dimension Scaling (if 4x requested)
  const targetWidth = inWidth * scale;
  const targetHeight = inHeight * scale;

  const finalCanvas = new OffscreenCanvas(targetWidth, targetHeight);
  const finalCtx = finalCanvas.getContext('2d', { willReadFrequently: true });
  if (!finalCtx) {
    throw new Error("Unable to create target 2D context");
  }

  finalCtx.imageSmoothingEnabled = true;
  finalCtx.imageSmoothingQuality = 'high';

  const pass1Bitmap = await createImageBitmap(canvasPass1);
  finalCtx.drawImage(pass1Bitmap, 0, 0, targetWidth, targetHeight);
  pass1Bitmap.close();

  // Stage 3: High-Frequency Structural Detail Synthesis
  // Sharpens linework, typography, and micro-textures
  applyStructuralSharpening(finalCtx, targetWidth, targetHeight, options.preset, scale);

  // Convert to PNG Blob
  if (typeof (finalCanvas as any).convertToBlob === 'function') {
    return await (finalCanvas as any).convertToBlob({ type: 'image/png' });
  }

  const exportBitmap = await createImageBitmap(finalCanvas);
  const fallbackCanvas = document.createElement('canvas');
  fallbackCanvas.width = targetWidth;
  fallbackCanvas.height = targetHeight;
  const ctx = fallbackCanvas.getContext('2d');
  if (ctx) {
    ctx.drawImage(exportBitmap, 0, 0);
  }
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

    let gain = 0.45;
    if (preset === 'text') gain = 0.75;
    if (preset === 'anime') gain = 0.60;
    if (preset === 'portrait') gain = 0.35;

    // Convolve with 3x3 Laplacian edge-enhancement kernel
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

        if (Math.abs(lap) > 6) {
          const delta = Math.max(-45, Math.min(45, lap * gain));
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