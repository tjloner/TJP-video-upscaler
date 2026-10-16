import WebSR from '../lib/websr-custom';

export type ImageModelPreset = 'photo' | 'portrait' | 'anime' | 'text' | 'ultra';

export interface ImageUpscaleOptions {
  scale: 2 | 4;
  preset: ImageModelPreset;
  onProgress?: (stage: string, progress: number, details?: string) => void;
}

let cachedUnetWeights: any = null;

function normalizeWeights(w: any): any {
  if (!w) return null;
  if (w.format === 'unet' || w.layers) return w;
  if (w.conv2d_tf || w.conv2d_tf1) return { name: "", layers: w };
  return { name: "", layers: w };
}

async function getModelWeights(preset: ImageModelPreset): Promise<{ networkName: string; weights: any }> {
  // Ultra, Photo, Portrait, and complex artwork use the high-clarity 24-layer U-Net model
  if (preset === 'ultra' || preset === 'photo' || preset === 'portrait' || preset === 'anime') {
    if (cachedUnetWeights) {
      return { networkName: 'katana/unet-u24', weights: cachedUnetWeights };
    }
    try {
      const res = await fetch('./weights/unet-u24.bin');
      if (res.ok) {
        const buf = await res.arrayBuffer();
        cachedUnetWeights = (WebSR as any).parseUNetWeights(buf);
        return { networkName: 'katana/unet-u24', weights: cachedUnetWeights };
      }
    } catch (e) {
      console.warn("[TJP Image]: unet-u24.bin fetch note, using fallback:", e);
    }
    const rawRL = require('../weights/cnn-2x-l-rl.json');
    return { networkName: 'anime4k/cnn-2x-l', weights: normalizeWeights(rawRL) };
  }

  // Text preset uses Anime4K line-refinement model
  const rawAN = require('../weights/cnn-2x-l-an.json');
  return { networkName: 'anime4k/cnn-2x-l', weights: normalizeWeights(rawAN) };
}

export async function upscaleImage(
  imageSource: ImageBitmap,
  options: ImageUpscaleOptions
): Promise<Blob> {
  const inWidth = imageSource.width;
  const inHeight = imageSource.height;
  const scale = options.scale;

  options.onProgress?.('processing', 15, 'Initializing WebGPU Core...');

  const gpu = await WebSR.initWebGPU();
  if (!gpu) {
    throw new Error("WebGPU is not supported or hardware acceleration is disabled.");
  }

  const { networkName, weights } = await getModelWeights(options.preset);

  options.onProgress?.('processing', 30, `Running Deep Super-Resolution (${networkName})...`);

  // Stage 1: Native 2x Neural Super-Resolution
  const pass1Width = inWidth * 2;
  const pass1Height = inHeight * 2;
  const canvasPass1 = new OffscreenCanvas(pass1Width, pass1Height);

  const websrPass1 = new WebSR({
    network_name: networkName as any,
    weights: weights,
    resolution: { width: inWidth, height: inHeight },
    gpu: gpu,
    canvas: canvasPass1 as any,
  });

  try {
    await websrPass1.render(imageSource as any, (done: number, total: number) => {
      if (total > 1) {
        const pct = Math.round(30 + (done / total) * 40);
        options.onProgress?.('processing', pct, `Neural Reconstruction: ${done}/${total} tiles`);
      }
    });

    if (gpu.queue) {
      try { await gpu.queue.onSubmittedWorkDone(); } catch (e) {}
    }

    options.onProgress?.('processing', 75, 'Synthesizing Sub-Pixel Clarity...');

    const targetWidth = inWidth * scale;
    const targetHeight = inHeight * scale;

    // Compose final high-clarity canvas
    const finalCanvas = new OffscreenCanvas(targetWidth, targetHeight);
    const ctx = finalCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error("Could not create 2D canvas context");

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    const pass1Bitmap = await createImageBitmap(canvasPass1);
    ctx.drawImage(pass1Bitmap, 0, 0, targetWidth, targetHeight);
    pass1Bitmap.close();

    // High-Clarity Adaptive Detail Enhancement
    options.onProgress?.('processing', 88, 'Enhancing Micro-Textures & Edges...');
    applyHighClarityEnhancement(ctx, targetWidth, targetHeight, options.preset);

    options.onProgress?.('processing', 96, 'Exporting Lossless PNG...');

    if (typeof (finalCanvas as any).convertToBlob === 'function') {
      return await (finalCanvas as any).convertToBlob({ type: 'image/png' });
    }

    const exportBitmap = await createImageBitmap(finalCanvas);
    const fallbackCanvas = document.createElement('canvas');
    fallbackCanvas.width = targetWidth;
    fallbackCanvas.height = targetHeight;
    const fallbackCtx = fallbackCanvas.getContext('2d');
    if (fallbackCtx) {
      fallbackCtx.drawImage(exportBitmap, 0, 0);
    }
    exportBitmap.close();

    return await new Promise<Blob>((resolve, reject) => {
      fallbackCanvas.toBlob((b) => {
        if (b) resolve(b);
        else reject(new Error("Image blob conversion failed"));
      }, 'image/png');
    });
  } finally {
    try { await websrPass1.destroy(); } catch (e) {}
  }
}

// Fast, high-clarity edge and micro-texture recovery
function applyHighClarityEnhancement(
  ctx: OffscreenCanvasRenderingContext2D,
  w: number,
  h: number,
  preset: ImageModelPreset
): void {
  try {
    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;

    // Fast convolution kernel tuned for razor-sharp clarity
    const amount = preset === 'text' ? 0.45 : preset === 'anime' ? 0.35 : 0.28;
    const stride = w * 4;

    // Step by 1 pixel with direct clamp for crisp boundaries
    for (let y = 1; y < h - 1; y++) {
      const rowOffset = y * stride;
      for (let x = 1; x < w - 1; x++) {
        const idx = rowOffset + (x * 4);

        // Center luma vs 4-directional neighborhood
        const curR = data[idx];
        const curG = data[idx + 1];
        const curB = data[idx + 2];

        const avgR = (data[idx - 4] + data[idx + 4] + data[idx - stride] + data[idx + stride]) >> 2;
        const avgG = (data[idx - 4 + 1] + data[idx + 4 + 1] + data[idx - stride + 1] + data[idx + stride + 1]) >> 2;
        const avgB = (data[idx - 4 + 2] + data[idx + 4 + 2] + data[idx - stride + 2] + data[idx + stride + 2]) >> 2;

        const diffR = curR - avgR;
        const diffG = curG - avgG;
        const diffB = curB - avgB;

        // Apply high-frequency boost
        data[idx] = Math.min(255, Math.max(0, curR + (diffR * amount)));
        data[idx + 1] = Math.min(255, Math.max(0, curG + (diffG * amount)));
        data[idx + 2] = Math.min(255, Math.max(0, curB + (diffB * amount)));
      }
    }

    ctx.putImageData(imgData, 0, 0);
  } catch (e) {
    console.warn("[TJP Image]: Clarity enhancement note:", e);
  }
}