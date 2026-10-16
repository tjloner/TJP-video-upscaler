/**
 * TJP AI Studio — In-Browser Studio Audio & Voice Mastering Suite
 * Dual-Engine Architecture:
 * 1. 🎙️ Voice & Speech Mode: Adaptive noise gate, 6.8kHz de-esser, chest warmth, podcast leveling.
 * 2. 🎵 Music & Song Mode: Sub-bass punch (55Hz), stereo widening, mastering bus compression, zero gate.
 * Supports direct audio extraction from both Audio (MP3, WAV, M4A, AAC) and Video (MP4, MOV, WebM).
 */

export type AudioMode = 'voice' | 'music';

export interface AudioProcessingProgress {
  (progress: number, stage: string): void;
}

export interface AudioEnhancementOptions {
  mode?: AudioMode;             // 'voice' | 'music' (default: 'voice')
  denoiseStrength?: number;     // 0.0 to 1.0 (used in voice mode)
  vocalWarmth?: boolean;        // 160Hz chest presence
  presenceBoost?: boolean;      // Front-and-center clarity
  broadcastLeveling?: boolean;  // Normalizes loudness without distortion
  stereoWidening?: boolean;     // 3D spatial field (used in music mode)
}

export async function enhanceAudioFile(
  file: File | Blob,
  options: AudioEnhancementOptions = {},
  onProgress?: AudioProcessingProgress
): Promise<{ blob: Blob; durationSec: number }> {
  const mode: AudioMode = options.mode || 'voice';

  onProgress?.(10, 'Decoding media audio stream (Audio or Video)...');

  const arrayBuffer = await file.arrayBuffer();
  const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 48000 });

  let decodedBuffer: AudioBuffer;
  try {
    decodedBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  } catch {
    await audioCtx.close();
    throw new Error('Unable to decode audio track. Please ensure the file is a valid MP4, MOV, WebM, MP3, WAV, or M4A.');
  }

  const durationSec = decodedBuffer.duration;
  const numChannels = decodedBuffer.numberOfChannels;
  const sampleRate = decodedBuffer.sampleRate;
  const numFrames = decodedBuffer.length;

  onProgress?.(30, mode === 'voice' 
    ? 'Calibrating speech de-esser, proximity warmth & vocal EQ...' 
    : 'Calibrating sub-bass punch, stereo field & mastering glue...');

  const offlineCtx = new OfflineAudioContext(numChannels, numFrames, sampleRate);

  const sourceNode = offlineCtx.createBufferSource();
  sourceNode.buffer = decodedBuffer;

  let lastNode: AudioNode = sourceNode;

  if (mode === 'voice') {
    // =========================================================================
    // 🎙️ VOICE & SPEECH MASTERING CHAIN
    // =========================================================================

    // 1. High-Pass Filter (strips room rumble & plosives < 80Hz)
    const highPass = offlineCtx.createBiquadFilter();
    highPass.type = 'highpass';
    highPass.frequency.value = 80;
    highPass.Q.value = 0.707;
    lastNode.connect(highPass);
    lastNode = highPass;

    // 2. Chest Warmth (160Hz broadcast microphone body)
    const warmthEq = offlineCtx.createBiquadFilter();
    warmthEq.type = 'peaking';
    warmthEq.frequency.value = 160;
    warmthEq.gain.value = options.vocalWarmth !== false ? 2.8 : 0.0;
    warmthEq.Q.value = 1.0;
    lastNode.connect(warmthEq);
    lastNode = warmthEq;

    // 3. De-Mud Filter (removes boxy 340Hz room resonance)
    const deMudEq = offlineCtx.createBiquadFilter();
    deMudEq.type = 'peaking';
    deMudEq.frequency.value = 340;
    deMudEq.gain.value = -3.2;
    deMudEq.Q.value = 1.3;
    lastNode.connect(deMudEq);
    lastNode = deMudEq;

    // 4. Speech Articulation (3.5kHz clarity boost)
    const presenceEq = offlineCtx.createBiquadFilter();
    presenceEq.type = 'peaking';
    presenceEq.frequency.value = 3500;
    presenceEq.gain.value = options.presenceBoost !== false ? 3.8 : 0.0;
    presenceEq.Q.value = 1.1;
    lastNode.connect(presenceEq);
    lastNode = presenceEq;

    // 5. De-Esser (tames harsh "S" and "T" sibilance at 6.8kHz)
    const deEsser = offlineCtx.createBiquadFilter();
    deEsser.type = 'peaking';
    deEsser.frequency.value = 6800;
    deEsser.gain.value = -2.8;
    deEsser.Q.value = 2.2;
    lastNode.connect(deEsser);
    lastNode = deEsser;

    // 6. Vocal Air (11kHz condenser microphone sheen)
    const airShelf = offlineCtx.createBiquadFilter();
    airShelf.type = 'highshelf';
    airShelf.frequency.value = 11000;
    airShelf.gain.value = 2.5;
    lastNode.connect(airShelf);
    lastNode = airShelf;

    // 7. Speech Vocal Compressor (levels whisper vs shouting)
    const voiceCompressor = offlineCtx.createDynamicsCompressor();
    voiceCompressor.threshold.value = -22;
    voiceCompressor.knee.value = 12;
    voiceCompressor.ratio.value = 3.8;
    voiceCompressor.attack.value = 0.004;
    voiceCompressor.release.value = 0.12;
    lastNode.connect(voiceCompressor);
    lastNode = voiceCompressor;

  } else {
    // =========================================================================
    // 🎵 MUSIC & SONG MASTERING CHAIN (ZERO NOISE GATE)
    // =========================================================================

    // 1. Sub-Bass Warmth & Kick Drum Punch (55Hz shelf - preserves 808s and kicks)
    const subBassShelf = offlineCtx.createBiquadFilter();
    subBassShelf.type = 'lowshelf';
    subBassShelf.frequency.value = 55;
    subBassShelf.gain.value = 2.4;
    lastNode.connect(subBassShelf);
    lastNode = subBassShelf;

    // 2. Low-Mid Clarity (220Hz gentle clean-up of muddy buildup)
    const lowMidEq = offlineCtx.createBiquadFilter();
    lowMidEq.type = 'peaking';
    lowMidEq.frequency.value = 220;
    lowMidEq.gain.value = -1.6;
    lowMidEq.Q.value = 1.0;
    lastNode.connect(lowMidEq);
    lastNode = lowMidEq;

    // 3. Musical Presence (2.8kHz instrument & vocal focus)
    const musicPresenceEq = offlineCtx.createBiquadFilter();
    musicPresenceEq.type = 'peaking';
    musicPresenceEq.frequency.value = 2800;
    musicPresenceEq.gain.value = 2.0;
    musicPresenceEq.Q.value = 1.0;
    lastNode.connect(musicPresenceEq);
    lastNode = musicPresenceEq;

    // 4. High-End Shimmer & Sparkle (12kHz shelf for cymbals and acoustic depth)
    const musicAirShelf = offlineCtx.createBiquadFilter();
    musicAirShelf.type = 'highshelf';
    musicAirShelf.frequency.value = 12000;
    musicAirShelf.gain.value = 3.2;
    lastNode.connect(musicAirShelf);
    lastNode = musicAirShelf;

    // 5. Transparent Music Mastering Bus Compressor (preserves punchy drum transients)
    const musicCompressor = offlineCtx.createDynamicsCompressor();
    musicCompressor.threshold.value = -18;
    musicCompressor.knee.value = 16;
    musicCompressor.ratio.value = 2.4;
    musicCompressor.attack.value = 0.025; // 25ms: allows drum snap through
    musicCompressor.release.value = 0.20;
    lastNode.connect(musicCompressor);
    lastNode = musicCompressor;
  }

  lastNode.connect(offlineCtx.destination);
  sourceNode.start(0);

  onProgress?.(55, mode === 'voice' 
    ? 'Executing hardware vocal passes...' 
    : 'Executing stereo mastering pass...');

  const renderedBuffer = await offlineCtx.startRendering();

  // Apply Post-DSP Mastering
  onProgress?.(75, mode === 'voice'
    ? 'Applying adaptive noise gate & voice loudness normalization...'
    : 'Applying stereo spatial widening & true-peak limiter...');

  const masteredBuffer = mode === 'voice'
    ? applyVoiceNoiseGateAndLimiter(renderedBuffer, options.denoiseStrength ?? 0.65, options.broadcastLeveling !== false)
    : applyMusicStereoWidenerAndLimiter(renderedBuffer, options.stereoWidening !== false);

  onProgress?.(92, 'Encoding lossless 48kHz WAV master...');
  const wavBlob = audioBufferToWavBlob(masteredBuffer);

  onProgress?.(100, mode === 'voice' ? 'Studio voice enhancement complete!' : 'Studio music mastering complete!');
  await audioCtx.close();

  return { blob: wavBlob, durationSec };
}

/**
 * VOICE DSP: Adaptive Downward Noise Gate & Soft-Knee True-Peak Limiter
 */
function applyVoiceNoiseGateAndLimiter(
  buffer: AudioBuffer,
  denoiseStrength: number,
  enableLeveling: boolean
): AudioBuffer {
  const numChannels = buffer.numberOfChannels;
  const numFrames = buffer.length;
  const sampleRate = buffer.sampleRate;

  const windowSize = Math.floor(sampleRate * 0.015); // 15ms window
  const gateThreshold = 0.012 * denoiseStrength;
  const maxAttenuationDb = -22 * denoiseStrength;
  const minGain = Math.pow(10, maxAttenuationDb / 20);

  let maxPeak = 0;
  for (let c = 0; c < numChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < numFrames; i += 16) {
      const absVal = Math.abs(data[i]);
      if (absVal > maxPeak) maxPeak = absVal;
    }
  }

  let makeupGain = 1.0;
  if (enableLeveling && maxPeak > 0.001) {
    makeupGain = Math.min(3.5, 0.91 / maxPeak); // -0.8 dBFS ceiling
  }

  let currentGateGain = 1.0;
  const attackAlpha = 0.12;
  const releaseAlpha = 0.015;

  for (let i = 0; i < numFrames; i++) {
    if (i % windowSize === 0) {
      let energy = 0;
      const count = Math.min(windowSize, numFrames - i);
      for (let c = 0; c < numChannels; c++) {
        const data = buffer.getChannelData(c);
        for (let k = 0; k < count; k += 4) {
          energy += data[i + k] * data[i + k];
        }
      }
      const rms = Math.sqrt(energy / (count * numChannels));
      const targetGain = rms < gateThreshold ? minGain : 1.0;

      if (targetGain < currentGateGain) {
        currentGateGain += (targetGain - currentGateGain) * releaseAlpha;
      } else {
        currentGateGain += (targetGain - currentGateGain) * attackAlpha;
      }
    }

    for (let c = 0; c < numChannels; c++) {
      const data = buffer.getChannelData(c);
      let s = data[i] * currentGateGain * makeupGain;

      // Soft-knee brickwall limiter (zero digital clipping)
      if (s > 0.88) {
        s = 0.88 + 0.10 * Math.tanh((s - 0.88) / 0.10);
      } else if (s < -0.88) {
        s = -0.88 + 0.10 * Math.tanh((s + 0.88) / 0.10);
      }

      data[i] = Math.max(-0.98, Math.min(0.98, s));
    }
  }

  return buffer;
}

/**
 * MUSIC DSP: Stereo Spatial Widener & Streaming Loudness Limiter (NO NOISE GATE)
 */
function applyMusicStereoWidenerAndLimiter(
  buffer: AudioBuffer,
  enableWidening: boolean
): AudioBuffer {
  const numChannels = buffer.numberOfChannels;
  const numFrames = buffer.length;

  // 1. Mid-Side Spatial Stereo Widener (expands soundstage without phase cancellation)
  if (enableWidening && numChannels >= 2) {
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);
    const widthFactor = 1.25; // 25% stereo enhancement

    for (let i = 0; i < numFrames; i++) {
      const mid = (left[i] + right[i]) * 0.5;
      const side = (left[i] - right[i]) * 0.5;
      left[i] = mid + side * widthFactor;
      right[i] = mid - side * widthFactor;
    }
  }

  // 2. Measure Peak Amplitude
  let maxPeak = 0;
  for (let c = 0; c < numChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < numFrames; i += 16) {
      const val = Math.abs(data[i]);
      if (val > maxPeak) maxPeak = val;
    }
  }

  // 3. Radio / Streaming Target Makeup Gain (-0.5 dB True-Peak target)
  let makeupGain = 1.0;
  if (maxPeak > 0.001) {
    makeupGain = Math.min(2.5, 0.94 / maxPeak);
  }

  // 4. Soft-knee brickwall limiter
  for (let c = 0; c < numChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < numFrames; i++) {
      let s = data[i] * makeupGain;
      if (s > 0.89) {
        s = 0.89 + 0.09 * Math.tanh((s - 0.89) / 0.09);
      } else if (s < -0.89) {
        s = -0.89 + 0.09 * Math.tanh((s + 0.89) / 0.09);
      }
      data[i] = Math.max(-0.98, Math.min(0.98, s));
    }
  }

  return buffer;
}

/**
 * Lossless 16-bit 48kHz PCM WAV Encoder
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