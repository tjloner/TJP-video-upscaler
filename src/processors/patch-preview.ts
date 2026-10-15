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
  containerWidth: number;
  containerHeight: number;
  onCropChange: (crop: CropRect) => void;
}

export class PatchPreviewController {
  private video: HTMLVideoElement;
  private minimapCanvas: HTMLCanvasElement;
  private minimapCtx: CanvasRenderingContext2D;
  private viewportBox: HTMLElement;
  private onCropChange: (crop: CropRect) => void;

  public crop: CropRect = { x: 0, y: 0, width: 320, height: 320 };
  private isDraggingMinimap: boolean = false;
  private minimapScale: number = 1;

  constructor(config: PatchPreviewConfig) {
    this.video = config.video;
    this.minimapCanvas = config.minimapCanvas;
    this.minimapCtx = this.minimapCanvas.getContext('2d')!;
    this.viewportBox = config.viewportBox;
    this.onCropChange = config.onCropChange;

    this.initMinimap(config.containerWidth, config.containerHeight);
    this.bindEvents();
  }

  /**
   * Initializes the minimap thumbnail and sets initial crop centered on the action/face
   */
  public initMinimap(containerW: number, containerH: number): void {
    const vW = this.video.videoWidth || 640;
    const vH = this.video.videoHeight || 360;

    // Minimap thumbnail dimensions (max 100px width)
    const maxMiniW = 100;
    const miniW = maxMiniW;
    const miniH = Math.round(maxMiniW * (vH / vW));

    this.minimapCanvas.width = miniW;
    this.minimapCanvas.height = miniH;
    this.minimapScale = miniW / vW;

    // Crop size (e.g. 320x320 patch for 1:1 native inspection)
    const patchSize = Math.min(360, Math.min(vW, vH));
    this.crop = {
      x: Math.round((vW - patchSize) / 2),
      y: Math.round((vH - patchSize) / 2),
      width: patchSize,
      height: patchSize
    };

    this.renderMinimap();
    this.updateViewportBoxStyle();
  }

  /**
   * Renders the whole frame thumbnail on the minimap
   */
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

  /**
   * Updates the purple viewport box CSS coordinates over the minimap
   */
  private updateViewportBoxStyle(): void {
    const boxX = Math.round(this.crop.x * this.minimapScale);
    const boxY = Math.round(this.crop.y * this.minimapScale);
    const boxW = Math.round(this.crop.width * this.minimapScale);
    const boxH = Math.round(this.crop.height * this.minimapScale);

    this.viewportBox.style.left = `${boxX}px`;
    this.viewportBox.style.top = `${boxY}px`;
    this.viewportBox.style.width = `${boxW}px`;
    this.viewportBox.style.height = `${boxH}px`;
  }

  /**
   * Updates crop position from client coordinates on the minimap
   */
  public setCropFromMinimap(clientX: number, clientY: number): void {
    const rect = this.minimapCanvas.getBoundingClientRect();
    const clickX = clientX - rect.left;
    const clickY = clientY - rect.top;

    const vW = this.video.videoWidth || 640;
    const vH = this.video.videoHeight || 360;

    // Convert click position to video coordinates (centered on click)
    const targetCenterX = clickX / this.minimapScale;
    const targetCenterY = clickY / this.minimapScale;

    let newX = Math.round(targetCenterX - this.crop.width / 2);
    let newY = Math.round(targetCenterY - this.crop.height / 2);

    // Clamp inside video boundaries
    newX = Math.max(0, Math.min(vW - this.crop.width, newX));
    newY = Math.max(0, Math.min(vH - this.crop.height, newY));

    this.crop.x = newX;
    this.crop.y = newY;

    this.updateViewportBoxStyle();
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

  /**
   * Extracts the cropped ImageBitmap from the video frame for neural inference
   */
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