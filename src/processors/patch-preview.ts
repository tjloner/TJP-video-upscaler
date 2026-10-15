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

  // 192x192 patch (matches free.upscaler.video for true 2x pixel inspection)
  public crop: CropRect = { x: 0, y: 0, width: 192, height: 192 };
  private isDraggingMinimap: boolean = false;
  private minimapScale: number = 1;

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
  }

  public initGeometry(): void {
    const vW = this.video.videoWidth || 640;
    const vH = this.video.videoHeight || 360;

    // Tight 192px crop: enables pixel-level comparison like free.upscaler.video
    const patchSize = Math.min(192, Math.min(vW, vH));
    const patchW = patchSize;
    const patchH = patchSize;

    this.crop = {
      x: Math.floor(Math.max(0, (vW - patchW) / 2) / 2) * 2,
      y: Math.floor(Math.max(0, (vH - patchH) / 2) / 2) * 2,
      width: patchW,
      height: patchH
    };

    // Magnify to 384x384 on screen so source pixels are visible on the left and sharp on the right
    const displaySize = patchSize * 2;
    this.playerFrame.style.width = `${displaySize}px`;
    this.playerFrame.style.height = `${displaySize}px`;
    this.playerFrame.style.minWidth = `${displaySize}px`;
    this.playerFrame.style.minHeight = `${displaySize}px`;

    // Minimap calculation
    const miniW = Math.round(Math.min(0.35 * displaySize, 120));
    const miniH = Math.round(miniW * (vH / vW));
    this.minimapCanvas.width = miniW;
    this.minimapCanvas.height = miniH;
    this.minimapCanvas.style.width = `${miniW}px`;
    this.minimapCanvas.style.height = `${miniH}px`;
    this.minimapScale = miniW / vW;

    this.renderMinimap();
    this.updateViewportBox();
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

  public async getCroppedBitmap(): Promise<ImageBitmap> {
    return await createImageBitmap(
      this.video,
      this.crop.x,
      this.crop.y,
      this.crop.width,
      this.crop.height
    );
  }
}