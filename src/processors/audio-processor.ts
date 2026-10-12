/**
 * TJP AI Studio — In-Browser Studio Voice & Audio Mastering Engine
 * 100% client-side Web Audio API processing (Zero server bandwidth/computation).
 */

export interface AudioProcessingProgress {
  (progress: number, stage: string): void;
}

export interface AudioEnhancementOptions {
  denoiseStrength?: number;     // 0.0 to 1.0
  vocalWarmth?: boolean;
  presenceBoost?: boolean;
  broadcastLeveling?: boolean;
}

export async function enhanceAudioFile(
  file: File | Blob,
  options: AudioEnhancementOptions = {},
  onProgress?: AudioProcessingProgress
): Promise<{ blob: Blob; durationSec: number }> {
  onProgress?.(10, 'Decoding input audio buffer...');

  const arrayBuffer = await file.arrayBuffer();
  const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 48000 });

  let decodedBuffer: AudioBuffer;
  try {
    decodedBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  } catch {
    await audioCtx.close();
    throw new Error('Unable to decode audio format. Please use MP3, WAV, M4A, or AAC.');
  }

  const durationSec = decodedBuffer.duration;
  const numChannels = decodedBuffer.numberOfChannels;
  const sampleRate = decodedBuffer.sampleRate;
  const numFrames = decodedBuffer.length;

  onProgress?.(30, 'Calibrating multi-band vocal presence & spectral filter...');

  // Offline Audio Context for faster-than-realtime hardware rendering
  const offlineCtx = new OfflineAudioContext(numChannels, numFrames, sampleRate);

  // 1. Source Node
  const sourceNode = offlineCtx.createBufferSource();
  sourceNode.buffer = decodedBuffer;

  // 2. High-Pass Filter (Strips rumble, mic wind, sub-bass air-conditioner hum < 80Hz)
  const highPass = offlineCtx.createBiquadFilter();
  highPass.type = 'highpass';
  highPass.frequency.value = 85;

  // 3. De-Mud EQ (Notches out boxy room resonance around 320Hz)
  const deMudEq = offlineCtx.createBiquadFilter();
  deMudEq.type = 'peaking';
  deMudEq.frequency.value = 320;
  deMudEq.gain.value = -3.5;
  deMudEq.Q.value = 1.4;

  // 4. Vocal Presence & Air Boost (3.8kHz crystal speech clarity)
  const presenceEq = offlineCtx.createBiquadFilter();
  presenceEq.type = 'peaking';
  presenceEq.frequency.value = 3800;
  presenceEq.gain.value = options.presenceBoost !== false ? 4.5 : 0.0;
  presenceEq.Q.value = 1.0;

  // 5. Studio Air Shelf (10kHz sweet high-end brilliance)
  const airShelf = offlineCtx.createBiquadFilter();
  airShelf.type = 'highshelf';
  airShelf.frequency.value = 10000;
  airShelf.gain.value = 3.0;

  // 6. Broadcast Dynamics Compressor (Balances whispering and shouting, stops clipping)
  const compressor = offlineCtx.createDynamicsCompressor();
  compressor.threshold.value = -20;
  compressor.knee.value = 10;
  compressor.ratio.value = 4.0;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.15;

  // Connect mastering graph
  sourceNode.connect(highPass);
  highPass.connect(deMudEq);
  deMudEq.connect(presenceEq);
  presenceEq.connect(airShelf);
  airShelf.connect(compressor);
  compressor.connect(offlineCtx.destination);

  sourceNode.start(0);

  onProgress?.(55, 'Rendering studio mastering passes...');

  const renderedBuffer = await offlineCtx.startRendering();

  onProgress?.(85, 'Encoding lossless WAV master...');

  const wavBlob = audioBufferToWavBlob(renderedBuffer);

  onProgress?.(100, 'Audio enhancement complete!');
  await audioCtx.close();

  return { blob: wavBlob, durationSec };
}

/**
 * Encodes an AudioBuffer into standard 16-bit PCM WAV Blob
 */
function audioBufferToWavBlob(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const numSamples = buffer.length * numChannels * 2;
  const bufferLen = 44 + numSamples;
  const out = new DataView(new ArrayBuffer(bufferLen));

  function writeString(offset: number, str: string) {
    for (let i = 0; i < str.length; i++) {
      out.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  // RIFF header
  writeString(0, 'RIFF');
  out.setUint32(4, 36 + numSamples, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  out.setUint32(16, 16, true);
  out.setUint16(20, 1, true); // PCM
  out.setUint16(22, numChannels, true);
  out.setUint32(24, sampleRate, true);
  out.setUint32(28, sampleRate * numChannels * 2, true);
  out.setUint16(32, numChannels * 2, true);
  out.setUint16(34, 16, true);
  writeString(36, 'data');
  out.setUint32(40, numSamples, true);

  // Interleave channels & write 16-bit PCM
  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let channel = 0; channel < numChannels; channel++) {
      const sample = Math.max(-1, Math.min(1, buffer.getChannelData(channel)[i]));
      const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      out.setInt16(offset, int16, true);
      offset += 2;
    }
  }

  return new Blob([out.buffer], { type: 'audio/wav' });
}