/**
 * Type-Safe Worker Message Definitions
 * Coordinates main thread UI and background GPU video processing
 */

export interface Resolution {
  width: number;
  height: number;
}

export type EngineMode = 'fast' | 'deep';

export interface RealTelemetryReport {
  status: 'PASSED' | 'FAILED';
  inputFrames: number;
  outputFrames: number;
  inputFps: number;
  outputAverageFps: number;
  videoDurationSec: number;
  audioDurationSec: number;
  avSyncDeltaMs: number;
  resolution: string;
  bitrateMbps: string;
  presetUsed: string;
  stagesExecuted: string[];
  failureReason?: string;
}

export interface InitData {
  bitmap: ImageBitmap;
  upscaled: OffscreenCanvas;
  original: OffscreenCanvas;
  resolution: Resolution;
}

export interface NetworkData {
  name: string;
  bitmap: ImageBitmap;
  weights: any;
}

export interface UpdatePreviewData {
  bitmap: ImageBitmap;
  resolution?: Resolution;
}

// Messages sent FROM main thread TO worker
export type WorkerRequestMessage =
  | { cmd: 'isSupported' }
  | { cmd: 'init'; data: InitData }
  | { cmd: 'network'; data: NetworkData }
  | { cmd: 'updatePreview'; data: UpdatePreviewData }
  | { 
      cmd: 'process'; 
      inputHandle: FileSystemFileHandle; 
      outputHandle?: FileSystemFileHandle;
      targetScale?: number;
      targetWidth?: number;
      targetHeight?: number;
      targetBitrate?: number;
      engineMode?: EngineMode;
      preset?: string;
      aiModel?: string;
    }
  | { cmd: 'pause' }
  | { cmd: 'resume' };

// Messages sent FROM worker TO main thread
export type WorkerResponseMessage =
  | { cmd: 'isSupported'; data: boolean }
  | { cmd: 'progress'; data: number }
  | { cmd: 'eta'; data: string }
  | { cmd: 'sourceReport'; data: any }
  | { cmd: 'process' }
  | { cmd: 'error'; data: string }
  | { cmd: 'finished'; data: Blob | null; report?: RealTelemetryReport }
  | { cmd: 'paused' }
  | { cmd: 'resumed' };

// Type guard helpers
export function isWorkerRequestMessage(msg: any): msg is WorkerRequestMessage {
  return msg && typeof msg.cmd === 'string';
}

export function isWorkerResponseMessage(msg: any): msg is WorkerResponseMessage {
  return msg && typeof msg.cmd === 'string';
}