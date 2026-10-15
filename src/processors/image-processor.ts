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
  // Ultra, Photo, and Portrait use the 24-layer U-Net model
  if (preset === 'ultra' || preset === 'photo' || preset === 'portrait') {
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
    // Bundled fallback (Real-Life photographic weights)
    const rawRL = require('../weights/cnn-2x-l-rl.json');
    return { networkName: 'anime4k/cnn-2x-l', weights: normalizeWeights(rawRL) };
  }

  // Anime and Text presets use line-thinning Anime4K model
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

  options.onProgress?.('processing', 15, 'Initializing WebGPU Device...');

  const gpu = await WebSR.initWebGPU();
  if (!gpu) {
    throw new Error("WebGPU is not supported or hardware acceleration is disabled.");
  }

  const { networkName, weights } = await getModelWeights(options.preset);

  options.onProgress?.('processing', 35, `Running Neural Super-Resolution (${networkName})...`);

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

  await websrPass1.render(imageSource as any, (done: number, total: number) => {
    if (total > 1) {
      const pct = Math.round(35 + (done / total) * 35);
      options.onProgress?.('processing', pct, `Tiled Reconstruction: ${done}/${total} patches`);
    }
  });

  // Await GPU execution flush
  if (gpu.queue) {
    try { await gpu.queue.onSubmittedWorkDone(); } catch (e) {}
  }

  options.onProgress?.('processing', 75, 'Composing target resolution...');

  // Stage 2: Target Dimension Scaling (if 4x requested)
  let finalCanvas: OffscreenCanvas = canvasPass1;
  const targetWidth = inWidth * scale;
  const targetHeight = inHeight * scale;

  if (scale === 4) {
    const canvasPass2 = new OffscreenCanvas(targetWidth, targetHeight);
    const ctx2 = canvasPass2.getContext('2d', { willReadFrequently: true });
    if (!ctx2) throw new Error("Could not create 2D canvas context");

    ctx2.imageSmoothingEnabled = true;
    ctx2.imageSmoothingQuality = 'high';

    const pass1Bitmap = await createImageBitmap(canvasPass1);
    ctx2.drawImage(pass1Bitmap, 0, 0, targetWidth, targetHeight);
    pass1Bitmap.close();

    // High-frequency detail synthesis on edges (only on canvases <= 4096 to prevent memory freeze)
    if (targetWidth <= 4096 && targetHeight <= 4096) {
      applyStructuralSharpening(ctx2, targetWidth, targetHeight, options.preset);
    }

    finalCanvas = canvasPass2;
  }

  options.onProgress?.('processing', 95, 'Exporting Lossless PNG...');

  // Clean export to PNG Blob
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
}

function applyStructuralSharpening(
  ctx: OffscreenCanvasRenderingContext2D,
  w: number,
  h: number,
  preset: ImageModelPreset
): void {
  try {
    const imgData = ctx.getImageData(0, 0, w, h);
    const d = imgData.data;
    const copy = new Uint8ClampedArray(d);

    const gain = preset === 'text' ? 0.70 : (preset === 'anime' ? 0.55 : 0.35);

    // Fast 3x3 Laplacian edge enhancement
    for (let y = 1; y < h - 1; y += 2) {
      for (let x = 1; x < w - 1; x += 2) {
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
          const delta = Math.max(-40, Math.min(40, lap * gain));
          d[idx] = Math.min(255, Math.max(0, copy[idx] + delta));
          d[idx + 1] = Math.min(255, Math.max(0, copy[idx + 1] + delta));
          d[idx + 2] = Math.min(255, Math.max(0, copy[idx + 2] + delta));
        }
      }
    }

    ctx.putImageData(imgData, 0, 0);
  } catch (e) {
    console.warn("[TJP Image]: Edge sharpening note:", e);
  }
}