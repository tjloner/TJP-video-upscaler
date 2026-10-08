import WebSR from '@websr/websr';
import { QualityPreset } from './source-analyzer';

export interface EngineSettings {
  preset: QualityPreset;
  deblockStrength: number;
  denoiseStrength: number;
  faceProtectionWeight: number;
  adaptiveSharpenStrength: number;
  colorAnchoring: boolean;
}

export class AdvancedRestorationEngine {
  private preCanvas: OffscreenCanvas;
  private preCtx: OffscreenCanvasRenderingContext2D;
  private postCanvas: OffscreenCanvas;
  private postCtx: OffscreenCanvasRenderingContext2D;
  
  // Temporal history buffer (luma planes)
  private prevLumaPlanes: Float32Array[] = [];
  private maxTemporalHistory = 2;

  constructor(
    private websr: WebSR,
    private inWidth: number,
    private inHeight: number,
    private outCanvas: OffscreenCanvas
  ) {
    // 360p Pre-Restoration Canvas
    this.preCanvas = new OffscreenCanvas(inWidth, inHeight);
    this.preCtx = this.preCanvas.getContext('2d', { willReadFrequently: true })!;

    // 720p Post-Processing Canvas
    this.postCanvas = new OffscreenCanvas(outCanvas.width, outCanvas.height);
    this.postCtx = this.postCanvas.getContext('2d', { willReadFrequently: true })!;
  }

  public resetTemporalHistory(): void {
    this.prevLumaPlanes = [];
  }

  /**
   * Accepts 2 or 3 arguments to prevent any TypeScript mismatch
   */
  public async processFrame(
    frame: VideoFrame,
    settings?: EngineSettings | any,
    isSceneBoundary: boolean = false
  ): Promise<void> {
    if (isSceneBoundary) {
      this.resetTemporalHistory();
    }

    const cfg: EngineSettings = settings || {
      preset: 'BALANCED',
      deblockStrength: 0.45,
      denoiseStrength: 0.25,
      faceProtectionWeight: 0.85,
      adaptiveSharpenStrength: 0.24,
      colorAnchoring: true
    };

    // 1. 360p Pre-Restoration (Deblock & Chroma Cleanse)
    this.preCtx.drawImage(frame, 0, 0, this.inWidth, this.inHeight);
    const preImgData = this.preCtx.getImageData(0, 0, this.inWidth, this.inHeight);
    const preData = preImgData.data;

    this.applyPreRestorationFilters(preData, this.inWidth, this.inHeight, cfg);
    this.preCtx.putImageData(preImgData, 0, 0);

    // 2. Temporal Luma Stabilization
    const currentLuma = this.extractLumaPlane(preData, this.inWidth, this.inHeight);
    if (this.prevLumaPlanes.length > 0 && !isSceneBoundary) {
      this.stabilizeTemporalLuma(preData, currentLuma, this.prevLumaPlanes, this.inWidth, this.inHeight);
    }
    
    this.prevLumaPlanes.push(currentLuma);
    if (this.prevLumaPlanes.length > this.maxTemporalHistory) {
      this.prevLumaPlanes.shift();
    }

    // 3. Neural 2× Super Resolution Pass
    const cleanSourceBitmap = await createImageBitmap(this.preCanvas);
    await this.websr.render(cleanSourceBitmap as any);
    cleanSourceBitmap.close();

    // 4. Content-Aware Face Protection & Color Anchoring
    this.postCtx.drawImage(this.outCanvas, 0, 0);
    const postImgData = this.postCtx.getImageData(0, 0, this.postCanvas.width, this.postCanvas.height);
    const postData = postImgData.data;

    this.applyContentAwareRefinement(
      postData, 
      preData, 
      this.postCanvas.width, 
      this.postCanvas.height, 
      this.inWidth, 
      this.inHeight, 
      cfg
    );

    this.postCtx.putImageData(postImgData, 0, 0);

    const outCtx = this.outCanvas.getContext('2d') || this.outCanvas.getContext('bitmaprenderer');
    if (outCtx && 'drawImage' in outCtx) {
      (outCtx as OffscreenCanvasRenderingContext2D).drawImage(this.postCanvas, 0, 0);
    }
  }

  private applyPreRestorationFilters(
    data: Uint8ClampedArray,
    w: number,
    h: number,
    settings: EngineSettings
  ): void {
    const deblock = settings.deblockStrength;
    const denoise = settings.denoiseStrength;
    const copy = new Uint8ClampedArray(data);

    for (let y = 1; y < h - 1; y++) {
      const isBlockRow = (y % 8 === 0 || y % 8 === 7);
      for (let x = 1; x < w - 1; x++) {
        const idx = (y * w + x) * 4;
        const isBlockCol = (x % 8 === 0 || x % 8 === 7);

        const leftIdx = (y * w + (x - 1)) * 4;
        const rightIdx = (y * w + (x + 1)) * 4;
        const upIdx = ((y - 1) * w + x) * 4;
        const downIdx = ((y + 1) * w + x) * 4;

        const gradX = Math.abs(copy[rightIdx] - copy[leftIdx]);
        const gradY = Math.abs(copy[downIdx] - copy[upIdx]);

        if ((isBlockRow || isBlockCol) && gradX < 35 && gradY < 35) {
          const avgR = (copy[leftIdx] + copy[rightIdx] + copy[upIdx] + copy[downIdx]) * 0.25;
          const avgG = (copy[leftIdx + 1] + copy[rightIdx + 1] + copy[upIdx + 1] + copy[downIdx + 1]) * 0.25;
          const avgB = (copy[leftIdx + 2] + copy[rightIdx + 2] + copy[upIdx + 2] + copy[downIdx + 2]) * 0.25;

          data[idx] = Math.round(copy[idx] * (1.0 - deblock * 0.5) + avgR * (deblock * 0.5));
          data[idx + 1] = Math.round(copy[idx + 1] * (1.0 - deblock * 0.5) + avgG * (deblock * 0.5));
          data[idx + 2] = Math.round(copy[idx + 2] * (1.0 - deblock * 0.5) + avgB * (deblock * 0.5));
        } else if (denoise > 0 && gradX < 18 && gradY < 18) {
          const avgR = (copy[leftIdx] + copy[rightIdx] + copy[upIdx] + copy[downIdx] + copy[idx] * 2) / 6;
          const avgG = (copy[leftIdx + 1] + copy[rightIdx + 1] + copy[upIdx + 1] + copy[downIdx + 1] + copy[idx + 1] * 2) / 6;
          const avgB = (copy[leftIdx + 2] + copy[rightIdx + 2] + copy[upIdx + 2] + copy[downIdx + 2] + copy[idx + 2] * 2) / 6;

          data[idx] = Math.round(copy[idx] * (1.0 - denoise * 0.4) + avgR * (denoise * 0.4));
          data[idx + 1] = Math.round(copy[idx + 1] * (1.0 - denoise * 0.4) + avgG * (denoise * 0.4));
          data[idx + 2] = Math.round(copy[idx + 2] * (1.0 - denoise * 0.4) + avgB * (denoise * 0.4));
        }
      }
    }
  }

  private extractLumaPlane(data: Uint8ClampedArray, w: number, h: number): Float32Array {
    const luma = new Float32Array(w * h);
    for (let i = 0; i < luma.length; i++) {
      const idx = i * 4;
      luma[i] = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
    }
    return luma;
  }

  private stabilizeTemporalLuma(
    data: Uint8ClampedArray,
    currentLuma: Float32Array,
    history: Float32Array[],
    w: number,
    h: number
  ): void {
    const prevLuma = history[history.length - 1];

    for (let i = 0; i < currentLuma.length; i++) {
      const delta = Math.abs(currentLuma[i] - prevLuma[i]);
      if (delta < 7.0) {
        const stabilizedLuma = currentLuma[i] * 0.70 + prevLuma[i] * 0.30;
        const factor = stabilizedLuma / Math.max(1.0, currentLuma[i]);
        const idx = i * 4;
        data[idx] = Math.min(255, Math.max(0, Math.round(data[idx] * factor)));
        data[idx + 1] = Math.min(255, Math.max(0, Math.round(data[idx + 1] * factor)));
        data[idx + 2] = Math.min(255, Math.max(0, Math.round(data[idx + 2] * factor)));
      }
    }
  }

  private applyContentAwareRefinement(
    postData: Uint8ClampedArray,
    sourcePreData: Uint8ClampedArray,
    outW: number,
    outH: number,
    inW: number,
    inH: number,
    settings: EngineSettings
  ): void {
    const sharpen = settings.adaptiveSharpenStrength;
    const faceProtect = settings.faceProtectionWeight;
    const copy = new Uint8ClampedArray(postData);

    for (let y = 1; y < outH - 1; y++) {
      const srcY = Math.min(inH - 1, Math.floor(y / 2));

      for (let x = 1; x < outW - 1; x++) {
        const idx = (y * outW + x) * 4;
        const srcX = Math.min(inW - 1, Math.floor(x / 2));
        const srcIdx = (srcY * inW + srcX) * 4;

        const r = copy[idx];
        const g = copy[idx + 1];
        const b = copy[idx + 2];

        // YCbCr Skin Locus (Faces & hands detection)
        const Y = 0.299 * r + 0.587 * g + 0.114 * b;
        const Cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
        const Cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;

        const isSkin = (Cb >= 77 && Cb <= 127 && Cr >= 133 && Cr <= 173);

        const up = 0.299 * copy[((y - 1) * outW + x) * 4] + 0.587 * copy[((y - 1) * outW + x) * 4 + 1] + 0.114 * copy[((y - 1) * outW + x) * 4 + 2];
        const down = 0.299 * copy[((y + 1) * outW + x) * 4] + 0.587 * copy[((y + 1) * outW + x) * 4 + 1] + 0.114 * copy[((y + 1) * outW + x) * 4 + 2];
        const left = 0.299 * copy[(y * outW + (x - 1)) * 4] + 0.587 * copy[(y * outW + (x - 1)) * 4 + 1] + 0.114 * copy[(y * outW + (x - 1)) * 4 + 2];
        const right = 0.299 * copy[(y * outW + (x + 1)) * 4] + 0.587 * copy[(y * outW + (x + 1)) * 4 + 1] + 0.114 * copy[(y * outW + (x + 1)) * 4 + 2];

        const localContrast = Math.max(Y, up, down, left, right) - Math.min(Y, up, down, left, right);

        let effectiveSharpen = sharpen;
        if (isSkin) {
          // Drastically reduce sharpening on human skin to preserve natural texture
          effectiveSharpen *= (1.0 - faceProtect * 0.75);
        } else if (localContrast > 45) {
          effectiveSharpen *= 1.15;
        } else if (localContrast < 12) {
          effectiveSharpen = 0;
        }

        if (effectiveSharpen > 0 && localContrast < 140) {
          const delta = (4 * Y - up - down - left - right) * effectiveSharpen * 0.35;
          postData[idx] = Math.min(255, Math.max(0, copy[idx] + delta));
          postData[idx + 1] = Math.min(255, Math.max(0, copy[idx + 1] + delta));
          postData[idx + 2] = Math.min(255, Math.max(0, copy[idx + 2] + delta));
        }

        // Color Anchoring to prevent color drift
        if (settings.colorAnchoring) {
          const srcR = sourcePreData[srcIdx];
          const srcG = sourcePreData[srcIdx + 1];
          const srcB = sourcePreData[srcIdx + 2];
          
          postData[idx] = Math.round(postData[idx] * 0.92 + srcR * 0.08);
          postData[idx + 1] = Math.round(postData[idx + 1] * 0.92 + srcG * 0.08);
          postData[idx + 2] = Math.round(postData[idx + 2] * 0.92 + srcB * 0.08);
        }
      }
    }
  }
}