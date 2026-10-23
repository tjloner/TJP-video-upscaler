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
  // Ultra, Photo, Portrait, and Anime all use the 24-layer U-Net model
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

  options.onProgress?.('processing', 10, 'Initializing High-Performance WebGPU Core...');

  const gpu = await WebSR.initWebGPU();
  if (!gpu) {
    throw new Error("WebGPU is not supported or hardware acceleration is disabled.");
  }

  // Hardware Tiering: query graphics memory limits for larger tiles
  const maxStorage = gpu.limits?.maxStorageBufferBindingSize || 134217728;
  const gpuTier = maxStorage >= 1073741824 ? 3 : (maxStorage >= 268435456 ? 2 : 1);

  const { networkName, weights } = await getModelWeights(options.preset);

  options.onProgress?.('processing', 15, `Phase 1: Deep Neural Super-Resolution (${networkName})...`);

  // ==========================================
  // PHASE 1: Native 2x Neural Reconstruction
  // ==========================================
  const pass1Width = inWidth * 2;
  const pass1Height = inHeight * 2;
  const canvasPass1 = new OffscreenCanvas(pass1Width, pass1Height);

  const websrPass1 = new WebSR({
    network_name: networkName as any,
    weights: weights,
    resolution: { width: inWidth, height: inHeight },
    gpu: gpu,
    canvas: canvasPass1 as any,
    tier: gpuTier
  });

  let finalCanvas: OffscreenCanvas = canvasPass1;

  try {
    let lastReportTime = 0;
    await websrPass1.render(imageSource as any, (done: number, total: number) => {
      const now = performance.now();
      if (now - lastReportTime > 80 || done === total) {
        lastReportTime = now;
        // If scale is 4, pass 1 is 15-50%. If scale is 2, pass 1 goes 15-85%.
        const pct = Math.round(15 + (done / total) * (scale === 4 ? 35 : 70));
        options.onProgress?.('processing', pct, `Neural Pass 1: ${done}/${total} large tiles`);
      }
    });

    if (gpu.queue) {
      try { await gpu.queue.onSubmittedWorkDone(); } catch (e) {}
    }

    // ==========================================
    // PHASE 2: True 4x Iterative Neural Gen
    // ==========================================
    if (scale === 4) {
      options.onProgress?.('processing', 55, `Phase 2: True 4× Neural Generation...`);
      await new Promise(resolve => setTimeout(resolve, 50)); // let UI breathe

      const pass2Width = pass1Width * 2;
      const pass2Height = pass1Height * 2;
      const canvasPass2 = new OffscreenCanvas(pass2Width, pass2Height);
      
      const pass1Bitmap = await createImageBitmap(canvasPass1);

      const websrPass2 = new WebSR({
        network_name: networkName as any,
        weights: weights,
        resolution: { width: pass1Width, height: pass1Height },
        gpu: gpu,
        canvas: canvasPass2 as any,
        tier: gpuTier
      });

      try {
        let lastReportTime2 = 0;
        await websrPass2.render(pass1Bitmap as any, (done: number, total: number) => {
          const now = performance.now();
          if (now - lastReportTime2 > 80 || done === total) {
            lastReportTime2 = now;
            const pct = Math.round(55 + (done / total) * 35);
            options.onProgress?.('processing', pct, `Neural Pass 2 (True 4×): ${done}/${total} tiles`);
          }
        });

        if (gpu.queue) {
          try { await gpu.queue.onSubmittedWorkDone(); } catch (e) {}
        }
        
        finalCanvas = canvasPass2;
      } finally {
        pass1Bitmap.close();
        try { await websrPass2.destroy(); } catch (e) {}
      }
    }

    // ==========================================
    // PHASE 3: Micro-Contrast & Output
    // ==========================================
    options.onProgress?.('processing', 92, 'Refining Micro-Textures & Contours...');
    await new Promise(resolve => setTimeout(resolve, 0));

    const ctx = finalCanvas.getContext('2d', { willReadFrequently: true });
    if (ctx) {
      applyHardwareClarityPass(ctx, finalCanvas.width, finalCanvas.height, options.preset);
    }

    options.onProgress?.('processing', 96, 'Exporting Lossless PNG...');
    await new Promise(resolve => setTimeout(resolve, 0));

    if (typeof (finalCanvas as any).convertToBlob === 'function') {
      return await (finalCanvas as any).convertToBlob({ type: 'image/png' });
    }

    const exportBitmap = await createImageBitmap(finalCanvas);
    const fallbackCanvas = document.createElement('canvas');
    fallbackCanvas.width = finalCanvas.width;
    fallbackCanvas.height = finalCanvas.height;
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

// Hardware-accelerated unsharp high-pass contrast pass without CPU loops
function applyHardwareClarityPass(
  ctx: OffscreenCanvasRenderingContext2D,
  w: number,
  h: number,
  preset: ImageModelPreset
): void {
  try {
    const sharpnessAmount = preset === 'text' ? 0.35 : (preset === 'anime' ? 0.28 : 0.22);

    ctx.save();
    // High-frequency subtle edge pop
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = sharpnessAmount;
    ctx.filter = 'contrast(1.08) brightness(1.01)';
    ctx.drawImage(ctx.canvas, 0, 0, w, h);
    ctx.restore();
  } catch (e) {
    console.warn("[TJP Image]: Hardware clarity note:", e);
  }
}
