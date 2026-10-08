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

  let targetWidth = inWidth * scale;
  let targetHeight = inHeight * scale;

  if (targetWidth > 8192 || targetHeight > 8192) {
    const clampRatio = Math.min(8192 / targetWidth, 8192 / targetHeight);
    targetWidth = Math.floor(targetWidth * clampRatio);
    targetHeight = Math.floor(targetHeight * clampRatio);
  }

  const gpu = await WebSR.initWebGPU();
  if (!gpu) {
    throw new Error("WebGPU is not supported or hardware acceleration is disabled.");
  }

  // Pass 1: 2x Super-Resolution
  const pass1Width = inWidth * 2;
  const pass1Height = inHeight * 2;
  const canvasPass1 = new OffscreenCanvas(pass1Width, pass1Height);

  const selectedWeights = modelWeights[options.preset] || photoWeights;
  const networkName = "anime4k/cnn-2x-l";

  const websrPass1 = new WebSR({
    network_name: networkName as any,
    weights: selectedWeights,
    resolution: { width: inWidth, height: inHeight },
    gpu: gpu,
    canvas: canvasPass1 as any,
  });

  await websrPass1.render(imageSource as any);

  let finalCanvas: OffscreenCanvas = canvasPass1;

  // Pass 2: Cascade to 4x if requested
  if (scale === 4) {
    const canvasPass2 = new OffscreenCanvas(pass1Width * 2, pass1Height * 2);
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

  if (options.preset === 'text') {
    applyTextPostFilter(finalCanvas);
  }

  // Type-safe blob export with browser fallback
  if (typeof (finalCanvas as any).convertToBlob === 'function') {
    return await (finalCanvas as any).convertToBlob({ type: 'image/png' });
  }

  const bitmap = await createImageBitmap(finalCanvas);
  const fallbackCanvas = document.createElement('canvas');
  fallbackCanvas.width = finalCanvas.width;
  fallbackCanvas.height = finalCanvas.height;
  const ctx = fallbackCanvas.getContext('2d');
  ctx?.drawImage(bitmap, 0, 0);
  bitmap.close();

  return await new Promise<Blob>((resolve, reject) => {
    fallbackCanvas.toBlob((b) => {
      if (b) resolve(b);
      else reject(new Error("Image conversion failed"));
    }, 'image/png');
  });
}

function applyTextPostFilter(canvas: OffscreenCanvas): void {
  try {
    const ctx = (canvas as any).getContext('2d') as OffscreenCanvasRenderingContext2D | null;
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const imgData = ctx.getImageData(0, 0, w, h);
    const d = imgData.data;

    for (let i = 0; i < d.length; i += 4) {
      const luma = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      if (luma > 210) {
        d[i] = Math.min(255, d[i] + 10);
        d[i + 1] = Math.min(255, d[i + 1] + 10);
        d[i + 2] = Math.min(255, d[i + 2] + 10);
      } else if (luma < 50) {
        d[i] = Math.max(0, d[i] - 10);
        d[i + 1] = Math.max(0, d[i + 1] - 10);
        d[i + 2] = Math.max(0, d[i + 2] - 10);
      }
    }
    ctx.putImageData(imgData, 0, 0);
  } catch {}
}