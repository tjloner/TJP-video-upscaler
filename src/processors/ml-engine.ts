import * as ort from 'onnxruntime-web';

// Use jsdelivr CDN for ONNX Runtime WASM assets to avoid local path resolution issues
ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/';
ort.env.wasm.numThreads = Math.min(4, navigator.hardwareConcurrency || 2);

export type MLModelType = 'realesrgan-photo' | 'realcugan-anime';

export interface MLProgressCallback {
  (stage: 'downloading' | 'processing', progress: number, details?: string): void;
}

// Reliable multi-source model mirrors with fallback
const MODEL_MIRRORS: Record<MLModelType, string[]> = {
  'realesrgan-photo': [
    'https://raw.githubusercontent.com/xinntao/Real-ESRGAN/master/weights/realesr-general-x4v3.onnx',
    'https://huggingface.co/csukuangfj/vits-models/resolve/main/realesrgan-x4plus.onnx'
  ],
  'realcugan-anime': [
    'https://raw.githubusercontent.com/xinntao/Real-ESRGAN/master/weights/realesr-general-x4v3.onnx'
  ]
};

let activeSession: ort.InferenceSession | null = null;
let currentModelLoaded: MLModelType | null = null;

async function fetchModelBufferWithFallback(modelType: MLModelType, onProgress?: MLProgressCallback): Promise<ArrayBuffer> {
  const mirrors = MODEL_MIRRORS[modelType] || [];
  const cacheName = 'tjp-ai-models-v2';

  // 1. Check local browser cache
  if ('caches' in window) {
    try {
      const cache = await caches.open(cacheName);
      for (const url of mirrors) {
        const cachedResponse = await cache.match(url);
        if (cachedResponse) {
          onProgress?.('downloading', 100, 'Loaded model from browser cache');
          return await cachedResponse.arrayBuffer();
        }
      }
    } catch {}
  }

  // 2. Attempt fetching from mirrors
  for (let i = 0; i < mirrors.length; i++) {
    const mirrorUrl = mirrors[i];
    try {
      onProgress?.('downloading', 25 + i * 20, `Connecting to Neural Weights (Mirror ${i + 1})...`);
      const response = await fetch(mirrorUrl, { mode: 'cors' });
      if (!response.ok) continue;

      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > 1000) {
        // Cache for future instant loads
        if ('caches' in window) {
          try {
            const cache = await caches.open(cacheName);
            await cache.put(mirrorUrl, new Response(buffer.slice(0), {
              headers: { 'content-type': 'application/octet-stream' }
            }));
          } catch {}
        }
        onProgress?.('downloading', 100, 'Model weights loaded successfully');
        return buffer;
      }
    } catch (e) {
      console.warn(`Mirror ${mirrorUrl} failed, trying next...`, e);
    }
  }

  throw new Error("External ML weights unreachable. Falling back to local WebGPU engine.");
}

async function getInferenceSession(modelType: MLModelType, onProgress?: MLProgressCallback): Promise<ort.InferenceSession> {
  if (activeSession && currentModelLoaded === modelType) {
    return activeSession;
  }

  const modelBuffer = await fetchModelBufferWithFallback(modelType, onProgress);
  onProgress?.('downloading', 100, 'Initializing WebGPU Execution Provider...');

  const options: ort.InferenceSession.SessionOptions = {
    executionProviders: ['webgpu', 'wasm'],
    graphOptimizationLevel: 'all'
  };

  activeSession = await ort.InferenceSession.create(modelBuffer, options);
  currentModelLoaded = modelType;
  return activeSession;
}

export async function runTiledSuperResolution(
  inputBitmap: ImageBitmap,
  modelType: MLModelType = 'realesrgan-photo',
  onProgress?: MLProgressCallback
): Promise<Blob> {
  const inW = inputBitmap.width;
  const inH = inputBitmap.height;
  const scale = 4;
  const outW = inW * scale;
  const outH = inH * scale;

  const session = await getInferenceSession(modelType, onProgress);

  const inCanvas = new OffscreenCanvas(inW, inH);
  const inCtx = inCanvas.getContext('2d')!;
  inCtx.drawImage(inputBitmap, 0, 0);

  const outCanvas = new OffscreenCanvas(outW, outH);
  const outCtx = outCanvas.getContext('2d')!;

  const tileSize = 256;
  const overlap = 16;

  const numTilesX = Math.ceil(inW / (tileSize - overlap * 2));
  const numTilesY = Math.ceil(inH / (tileSize - overlap * 2));
  const totalTiles = numTilesX * numTilesY;
  let tilesProcessed = 0;

  for (let ty = 0; ty < numTilesY; ty++) {
    for (let tx = 0; tx < numTilesX; tx++) {
      const startX = Math.max(0, tx * (tileSize - overlap * 2) - overlap);
      const startY = Math.max(0, ty * (tileSize - overlap * 2) - overlap);
      const actualW = Math.min(tileSize, inW - startX);
      const actualH = Math.min(tileSize, inH - startY);

      const tileImageData = inCtx.getImageData(startX, startY, actualW, actualH);
      
      const inputTensorData = new Float32Array(3 * actualH * actualW);
      const area = actualH * actualW;
      const d = tileImageData.data;

      for (let i = 0; i < area; i++) {
        inputTensorData[i] = d[i * 4] / 255.0;
        inputTensorData[area + i] = d[i * 4 + 1] / 255.0;
        inputTensorData[2 * area + i] = d[i * 4 + 2] / 255.0;
      }

      const inputTensor = new ort.Tensor('float32', inputTensorData, [1, 3, actualH, actualW]);
      const feeds: Record<string, ort.Tensor> = {};
      feeds[session.inputNames[0]] = inputTensor;

      const results = await session.run(feeds);
      const outputTensor = results[session.outputNames[0]];
      const outData = outputTensor.data as Float32Array;

      const tileOutW = actualW * scale;
      const tileOutH = actualH * scale;
      const outArea = tileOutW * tileOutH;

      const reconstructedTile = new ImageData(tileOutW, tileOutH);
      const recData = reconstructedTile.data;

      for (let i = 0; i < outArea; i++) {
        recData[i * 4] = Math.min(255, Math.max(0, Math.round(outData[i] * 255.0)));
        recData[i * 4 + 1] = Math.min(255, Math.max(0, Math.round(outData[outArea + i] * 255.0)));
        recData[i * 4 + 2] = Math.min(255, Math.max(0, Math.round(outData[2 * outArea + i] * 255.0)));
        recData[i * 4 + 3] = 255;
      }

      const tileBitmap = await createImageBitmap(reconstructedTile);
      outCtx.drawImage(tileBitmap, startX * scale, startY * scale);
      tileBitmap.close();

      tilesProcessed++;
      const progress = Math.round((tilesProcessed / totalTiles) * 100);
      onProgress?.('processing', progress, `Synthesizing Ultra Detail: ${progress}% (${tilesProcessed}/${totalTiles} tiles)`);
    }
  }

  if (typeof (outCanvas as any).convertToBlob === 'function') {
    return await (outCanvas as any).convertToBlob({ type: 'image/png' });
  }

  const exportBitmap = await createImageBitmap(outCanvas);
  const fallbackCanvas = document.createElement('canvas');
  fallbackCanvas.width = outW;
  fallbackCanvas.height = outH;
  const ctx = fallbackCanvas.getContext('2d');
  ctx?.drawImage(exportBitmap, 0, 0);
  exportBitmap.close();

  return await new Promise<Blob>((resolve, reject) => {
    fallbackCanvas.toBlob((b) => {
      if (b) resolve(b);
      else reject(new Error("Image blob conversion failed"));
    }, 'image/png');
  });
}