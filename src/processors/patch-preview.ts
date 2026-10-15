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

  public crop: CropRect = { x: 0, y: 0, width: 360, height: 360 };
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

    // Determine optimal patch size based on source video aspect ratio
    const isWidescreen = vW >= vH;
    let patchW = isWidescreen ? 480 : 360;
    let patchH = isWidescreen ? Math.round(patchW * (vH / vW)) : 420;

    patchW = Math.min(patchW, vW);
    patchH = Math.min(patchH, vH);

    // Initial center crop
    this.crop = {
      x: Math.max(0, Math.round((vW - patchW) / 2)),
      y: Math.max(0, Math.round((vH - patchH) / 2)),
      width: patchW,
      height: patchH
    };

    // Size frame using exact aspect ratio
    this.playerFrame.style.width = `${patchW}px`;
    this.playerFrame.style.maxWidth = '100%';
    this.compareContainer.style.aspectRatio = `${patchW} / ${patchH}`;

    // Size minimap: Math.min(0.3 * patchW, 160)
    const miniW = Math.round(Math.min(0.35 * patchW, 150));
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

    newX = Math.max(0, Math.min(vW - this.crop.width, newX));
    newY = Math.max(0, Math.min(vH - this.crop.height, newY));

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