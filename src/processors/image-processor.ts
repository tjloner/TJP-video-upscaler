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

  const selectedWeights = modelWeights[options.preset] || photoWeights;
  const networkName = "anime4k/cnn-2x-l";

  // =========================================================================
  // PASS 1: Native 2x Neural Super-Resolution (e.g. 800x800 -> 1600x1600)
  // =========================================================================
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

  let finalCanvas: OffscreenCanvas = canvasPass1;

  // =========================================================================
  // PASS 2: Cascaded 4x Neural Super-Resolution (1600x1600 -> 3200x3200)
  // =========================================================================
  if (scale === 4) {
    const pass2Width = pass1Width * 2;
    const pass2Height = pass1Height * 2;
    const canvasPass2 = new OffscreenCanvas(pass2Width, pass2Height);

    const pass1Bitmap = await createImageBitmap(canvasPass1);

    const websrPass2 = new WebSR({
      network_name: networkName as any,
      weights: selectedWeights,
      resolution: { width: pass1Width, height: pass1Height },
      gpu: gpu,
      canvas: canvasPass2 as any,
    });

    await websrPass2.render(pass1Bitmap as any);
    pass1Bitmap.close();
    finalCanvas = canvasPass2;
  }

  // =========================================================================
  // FINAL PASS: High-Frequency Structural Detail Synthesis
  // Sharpens eyelashes, hair strands, and textures to prevent soft stretch.
  // =========================================================================
  const enhancedCanvas = await applyHighFrequencyDetailPass(finalCanvas, options.preset, scale);

  // Convert cleanly to PNG Blob
  if (typeof (enhancedCanvas as any).convertToBlob === 'function') {
    return await (enhancedCanvas as any).convertToBlob({ type: 'image/png' });
  }

  const finalBitmap = await createImageBitmap(enhancedCanvas);
  const fallbackCanvas = document.createElement('canvas');
  fallbackCanvas.width = enhancedCanvas.width;
  fallbackCanvas.height = enhancedCanvas.height;
  const ctx = fallbackCanvas.getContext('2d');
  if (ctx) {
    ctx.drawImage(finalBitmap, 0, 0);
  }
  finalBitmap.close();

  return await new Promise<Blob>((resolve, reject) => {
    fallbackCanvas.toBlob((b) => {
      if (b) resolve(b);
      else reject(new Error("Image conversion failed"));
    }, 'image/png');
  });
}

/**
 * Optical High-Frequency Detail Synthesis
 * Applies sub-pixel contrast enhancement to micro-textures (hair, eyes, fabric)
 * while preserving smooth skin gradients and background tones.
 */
async function applyHighFrequencyDetailPass(
  sourceCanvas: OffscreenCanvas,
  preset: ImageModelPreset,
  scale: 2 | 4
): Promise<OffscreenCanvas> {
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;

  const targetCanvas = new OffscreenCanvas(w, h);
  const ctx = targetCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return sourceCanvas;

  const bitmap = await createImageBitmap(sourceCanvas);
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  // Tune strength based on preset profile
  let sharpenGain = scale === 4 ? 0.32 : 0.22;
  if (preset === 'portrait') sharpenGain = 0.20; // Keep skin smooth while eyes/hair pop
  if (preset === 'anime' || preset === 'text') sharpenGain = 0.40;

  try {
    const imgData = ctx.getImageData(0, 0, w, h);
    const d = imgData.data;
    const copy = new Uint8ClampedArray(d);

    for (let y = 1; y < h - 1; y += 2) {
      for (let x = 1; x < w - 1; x += 2) {
        const idx = (y * w + x) * 4;

        // Central luminance
        const lumaC = 0.299 * copy[idx] + 0.587 * copy[idx + 1] + 0.114 * copy[idx + 2];

        // 4-neighborhood luminance
        const idxN = ((y - 1) * w + x) * 4;
        const idxS = ((y + 1) * w + x) * 4;
        const idxW = (y * w + (x - 1)) * 4;
        const idxE = (y * w + (x + 1)) * 4;

        const lumaN = 0.299 * copy[idxN] + 0.587 * copy[idxN + 1] + 0.114 * copy[idxN + 2];
        const lumaS = 0.299 * copy[idxS] + 0.587 * copy[idxS + 1] + 0.114 * copy[idxS + 2];
        const lumaW = 0.299 * copy[idxW] + 0.587 * copy[idxW + 1] + 0.114 * copy[idxW + 2];
        const lumaE = 0.299 * copy[idxE] + 0.587 * copy[idxE + 1] + 0.114 * copy[idxE + 2];

        const minL = Math.min(lumaC, Math.min(Math.min(lumaN, lumaS), Math.min(lumaW, lumaE)));
        const maxL = Math.max(lumaC, Math.max(Math.max(lumaN, lumaS), Math.max(lumaW, lumaE)));
        const contrast = maxL - minL;

        // Skip flat skin tones/skies (contrast < 12) and blown-out highlights
        if (contrast > 12 && lumaC > 18 && lumaC < 240) {
          const laplacian = 4 * lumaC - (lumaN + lumaS + lumaW + lumaE);
          const delta = Math.max(-28, Math.min(28, laplacian * sharpenGain));

          d[idx] = Math.min(255, Math.max(0, copy[idx] + delta));
          d[idx + 1] = Math.min(255, Math.max(0, copy[idx + 1] + delta));
          d[idx + 2] = Math.min(255, Math.max(0, copy[idx + 2] + delta));
        }
      }
    }
    ctx.putImageData(imgData, 0, 0);
  } catch (e) {
    console.warn("High-frequency detail pass note:", e);
  }

  return targetCanvas;
}