export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PatchPreviewConfig {
  video: HTMLVideoElement;
  minimapCanvas: HTMLCanvasElement;
  viewportBox: HTMLElement;
  playerFrame: HTMLElement;
  compareContainer: HTMLElement;
  onCropChange: (crop: CropRect) => void;
}

export class PatchPreviewController {
  private video: HTMLVideoElement;
  private minimapCanvas: HTMLCanvasElement;
  private minimapCtx: CanvasRenderingContext2D;
  private viewportBox: HTMLElement;
  private playerFrame: HTMLElement;
  private compareContainer: HTMLElement;
  private onCropChange: (crop: CropRect) => void;

  public crop: CropRect = { x: 0, y: 0, width: 192, height: 192 };
  private isDraggingMinimap: boolean = false;
  private minimapScale: number = 1;
  public isZoomed: boolean = false; // Default: false = Full video frame view

  constructor(config: PatchPreviewConfig) {
    this.video = config.video;
    this.minimapCanvas = config.minimapCanvas;
    this.minimapCtx = this.minimapCanvas.getContext('2d')!;
    this.viewportBox = config.viewportBox;
    this.playerFrame = config.playerFrame;
    this.compareContainer = config.compareContainer;
    this.onCropChange = config.onCropChange;

    this.initGeometry();
    this.bindEvents();
    this.applyZoomModeStyles();
  }

  public initGeometry(): void {
    const vW = this.video.videoWidth || 640;
    const vH = this.video.videoHeight || 360;

    // 192px patch for 1:1 inspection mode
    const patchSize = Math.min(192, Math.min(vW, vH));
    const patchW = patchSize;
    const patchH = patchSize;

    this.crop = {
      x: Math.floor(Math.max(0, (vW - patchW) / 2) / 2) * 2,
      y: Math.floor(Math.max(0, (vH - patchH) / 2) / 2) * 2,
      width: patchW,
      height: patchH
    };

    // Minimap calculation
    const miniW = 100;
    const miniH = Math.round(miniW * (vH / vW));
    this.minimapCanvas.width = miniW;
    this.minimapCanvas.height = miniH;
    this.minimapCanvas.style.width = `${miniW}px`;
    this.minimapCanvas.style.height = `${miniH}px`;
    this.minimapScale = miniW / vW;

    this.applyZoomModeStyles();
    this.renderMinimap();
    this.updateViewportBox();
  }

  public setZoomMode(zoomed: boolean): void {
    this.isZoomed = zoomed;
    this.applyZoomModeStyles();
  }

  public toggleZoomMode(): boolean {
    this.isZoomed = !this.isZoomed;
    this.applyZoomModeStyles();
    return this.isZoomed;
  }

  private applyZoomModeStyles(): void {
    const minimapWrapper = this.minimapCanvas.parentElement;
    const vW = this.video.videoWidth || 640;
    const vH = this.video.videoHeight || 360;

    if (this.isZoomed) {
      // 1:1 Zoom inspection mode: 384x384 square crop with minimap
      if (minimapWrapper) minimapWrapper.style.display = 'block';
      this.playerFrame.style.width = '384px';
      this.playerFrame.style.height = '384px';
      this.playerFrame.style.aspectRatio = '1 / 1';
    } else {
      // Full frame mode: hide minimap and adapt frame aspect ratio to the video
      if (minimapWrapper) minimapWrapper.style.display = 'none';
      const maxDim = 384;
      const aspect = vW / vH;
      let displayW = maxDim;
      let displayH = Math.round(maxDim / aspect);
      if (displayH > maxDim) {
        displayH = maxDim;
        displayW = Math.round(maxDim * aspect);
      }
      this.playerFrame.style.width = `${displayW}px`;
      this.playerFrame.style.height = `${displayH}px`;
      this.playerFrame.style.aspectRatio = `${vW} / ${vH}`;
    }
  }

  public renderMinimap(): void {
    if (!this.minimapCtx) return;
    this.minimapCtx.drawImage(
      this.video,
      0,
      0,
      this.minimapCanvas.width,
      this.minimapCanvas.height
    );
  }

  private updateViewportBox(): void {
    const boxX = Math.round(this.crop.x * this.minimapScale);
    const boxY = Math.round(this.crop.y * this.minimapScale);
    const boxW = Math.round(this.crop.width * this.minimapScale);
    const boxH = Math.round(this.crop.height * this.minimapScale);

    this.viewportBox.style.left = `${boxX}px`;
    this.viewportBox.style.top = `${boxY}px`;
    this.viewportBox.style.width = `${boxW}px`;
    this.viewportBox.style.height = `${boxH}px`;
  }

  public setCropFromMinimap(clientX: number, clientY: number): void {
    if (!this.isZoomed) return;

    const rect = this.minimapCanvas.getBoundingClientRect();
    const clickX = clientX - rect.left;
    const clickY = clientY - rect.top;

    const vW = this.video.videoWidth || 640;
    const vH = this.video.videoHeight || 360;

    const targetCenterX = clickX / this.minimapScale;
    const targetCenterY = clickY / this.minimapScale;

    let newX = Math.round(targetCenterX - this.crop.width / 2);
    let newY = Math.round(targetCenterY - this.crop.height / 2);

    newX = Math.floor(Math.max(0, Math.min(vW - this.crop.width, newX)) / 2) * 2;
    newY = Math.floor(Math.max(0, Math.min(vH - this.crop.height, newY)) / 2) * 2;

    this.crop.x = newX;
    this.crop.y = newY;

    this.updateViewportBox();
    this.onCropChange(this.crop);
  }

  private bindEvents(): void {
    const container = this.minimapCanvas.parentElement;
    if (!container) return;

    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      this.isDraggingMinimap = true;
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
      this.setCropFromMinimap(clientX, clientY);
    };

    const onPointerMove = (e: MouseEvent | TouchEvent) => {
      if (!this.isDraggingMinimap) return;
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
      this.setCropFromMinimap(clientX, clientY);
    };

    const onPointerUp = () => {
      this.isDraggingMinimap = false;
    };

    container.addEventListener('mousedown', onPointerDown);
    container.addEventListener('touchstart', onPointerDown, { passive: true });

    window.addEventListener('mousemove', onPointerMove);
    window.addEventListener('touchmove', onPointerMove, { passive: true });

    window.addEventListener('mouseup', onPointerUp);
    window.addEventListener('touchend', onPointerUp);
  }

  // Returns either the full video scene or the 1:1 inspection patch depending on zoom mode
  public async getCroppedBitmap(): Promise<ImageBitmap> {
    const vW = this.video.videoWidth || 640;
    const vH = this.video.videoHeight || 360;

    if (!this.isZoomed) {
      // Full frame mode: fit entire video into WebGPU preview dimensions safely
      const maxDim = 384;
      const scale = Math.min(maxDim / vW, maxDim / vH);
      const targetW = Math.floor(Math.round(vW * scale) / 2) * 2;
      const targetH = Math.floor(Math.round(vH * scale) / 2) * 2;

      const canvas = document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d')!;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(this.video, 0, 0, targetW, targetH);
      return await createImageBitmap(canvas);
    }

    // Zoom mode: native 1:1 pixel inspection crop
    const canvas = document.createElement('canvas');
    canvas.width = this.crop.width;
    canvas.height = this.crop.height;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      this.video,
      this.crop.x, this.crop.y, this.crop.width, this.crop.height,
      0, 0, this.crop.width, this.crop.height
    );
    return await createImageBitmap(canvas);
  }
}