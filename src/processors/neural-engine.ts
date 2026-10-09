import WebSR from '@websr/websr';

export type EngineMode = 'fast' | 'deep';
export type UpscaleMode = EngineMode;

export interface NeuralEngineConfig {
  mode: EngineMode;
  inWidth: number;
  inHeight: number;
  outWidth: number;
  outHeight: number;
  gpuDevice: any;
  canvas: OffscreenCanvas;
}

/**
 * Clean GPU Neural Engine
 * Runs pure WebGPU neural convolution without artificial CPU pixel distortion
 */
export class UniversalNeuralEngine {
  private websr: WebSR | null = null;

  constructor(private config: NeuralEngineConfig) {
    // Select model weights based on user mode
    const weights = config.mode === 'fast'
      ? require('../weights/cnn-2x-s-an.json')
      : require('../weights/cnn-2x-l-an.json');

    const networkName = config.mode === 'fast'
      ? "anime4k/cnn-2x-s"
      : "anime4k/cnn-2x-l";

    try {
      this.websr = new WebSR({
        network_name: networkName as any,
        weights,
        resolution: { width: config.inWidth, height: config.inHeight },
        gpu: config.gpuDevice,
        canvas: config.canvas as any
      });
    } catch (e) {
      console.warn("NeuralEngine init note:", e);
    }
  }

  /**
   * Pure WebGPU Neural Inference (Direct pass, zero font degradation)
   */
  public async renderFrame(inputFrame: VideoFrame | ImageBitmap): Promise<void> {
    if (this.websr) {
      await this.websr.render(inputFrame as any);
    }
  }
}