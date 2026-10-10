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

  // Convert WebGPU OffscreenCanvas safely to Blob without context conflict
  if (typeof (finalCanvas as any).convertToBlob === 'function') {
    return await (finalCanvas as any).convertToBlob({ type: 'image/png' });
  }

  // Fallback for browsers lacking convertToBlob on OffscreenCanvas
  const finalBitmap = await createImageBitmap(finalCanvas);
  const fallbackCanvas = document.createElement('canvas');
  fallbackCanvas.width = finalCanvas.width;
  fallbackCanvas.height = finalCanvas.height;
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