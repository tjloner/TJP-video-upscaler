export type QualityPreset = 'NATURAL' | 'BALANCED' | 'HIGH_DETAIL' | 'REFERENCE_MATCH';
export type VideoContentType = 'real_life' | 'anime' | 'text_graphics';

export interface SourceLossMetrics {
  macroblockDamage: number;
  chromaSubsamplingLoss: number;
  mosquitoNoise: number;
  blurRadius: number;
  textureDegradation: number;
}

export interface VideoQualityProfile {
  width: number;
  height: number;
  fps: number;
  duration: number;
  bitrateKbps: number;
  aspectRatio: string;
  codec: string;
  
  qualityScore: number;
  estimatedSourceScore: number;

  noiseLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  compressionDamage: 'LIGHT' | 'MODERATE' | 'HEAVY';
  blurLevel: 'SHARP' | 'MODERATE' | 'BLURRY';
  contentType: VideoContentType;
  
  lossMetrics: SourceLossMetrics;
  recommendedPreset: QualityPreset;
  presetConfig: {
    deblockStrength: number;
    denoiseStrength: number;
    temporalWindowSize: number;
    faceProtectionWeight: number;
    adaptiveSharpenStrength: number;
    colorAnchoring: boolean;
    modelWeightProfile: 'rl' | 'an' | '3d';
  };
  recommendedStrategy: {
    upscaleFactor: 1 | 2 | 4;
    targetWidth: number;
    targetHeight: number;
    deblockStrength: number;
    denoiseStrength: number;
    adaptiveSharpen: number;
    modelProfile: 'faithful' | 'balanced' | 'creative';
  };
}

export function analyzeSourceVideo(
  videoTrack: any,
  resolution: { width: number; height: number },
  durationSec: number,
  fileSizeBytes: number
): VideoQualityProfile {
  const width = resolution.width;
  const height = resolution.height;
  
  const [fpsNum, fpsDen] = (videoTrack.r_frame_rate || '24/1').split('/').map(Number);
  const fps = fpsNum && fpsDen ? Math.round(fpsNum / fpsDen) : 24;

  const bitrateKbps = durationSec > 0 ? Math.round((fileSizeBytes * 8) / (durationSec * 1000)) : 650;
  const bitsPerPixel = (bitrateKbps * 1000) / Math.max(1, width * height * fps);

  const macroblockDamage = Math.min(1.0, Math.max(0.05, 0.22 / Math.max(0.04, bitsPerPixel)));
  const mosquitoNoise = Math.min(1.0, Math.max(0.1, macroblockDamage * 0.85));
  const chromaSubsamplingLoss = 0.5;
  const blurRadius = width <= 480 ? 1.6 : (width <= 720 ? 1.0 : 0.6);
  const textureDegradation = Math.min(1.0, Math.max(0.1, (1.0 - bitsPerPixel * 3.5)));

  let compressionDamage: 'LIGHT' | 'MODERATE' | 'HEAVY' = 'MODERATE';
  if (bitsPerPixel < 0.08) compressionDamage = 'HEAVY';
  else if (bitsPerPixel > 0.22) compressionDamage = 'LIGHT';

  let blurLevel: 'SHARP' | 'MODERATE' | 'BLURRY' = 'MODERATE';
  if (width < 720 || height < 480) blurLevel = 'BLURRY';
  else if (width >= 1920) blurLevel = 'SHARP';

  let noiseLevel: 'LOW' | 'MEDIUM' | 'HIGH' = 'MEDIUM';
  if (compressionDamage === 'HEAVY') noiseLevel = 'HIGH';
  else if (compressionDamage === 'LIGHT') noiseLevel = 'LOW';

  // Detect likely content type based on bit distribution and resolution characteristics
  // Standard video with normal or high bpp is natural real-life camera footage
  let contentType: VideoContentType = 'real_life';
  if (bitsPerPixel < 0.05 && (width === 1920 || width === 1280)) {
    // Ultra-low bpp at HD resolution typically indicates animated or synthetic content
    contentType = 'anime';
  }

  const score = Math.min(95, Math.max(20, Math.round(
    (Math.min(0.2, bitsPerPixel) / 0.2) * 35 +
    (Math.min(720, height) / 720) * 35 +
    (1.0 - macroblockDamage) * 15 +
    10
  )));

  let recommendedPreset: QualityPreset = 'BALANCED';
  if (macroblockDamage > 0.7) recommendedPreset = 'REFERENCE_MATCH';
  else if (bitsPerPixel > 0.18) recommendedPreset = 'HIGH_DETAIL';

  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const divisor = gcd(width, height) || 1;

  let upscaleFactor: 1 | 2 | 4 = 2;
  if (width >= 1920 || height >= 1080) upscaleFactor = 1;
  else if (width <= 480 || height <= 360) upscaleFactor = 2;

  const targetWidth = Math.floor((width * upscaleFactor) / 2) * 2;
  const targetHeight = Math.floor((height * upscaleFactor) / 2) * 2;

  const presetConfig = getPresetConfig(recommendedPreset, macroblockDamage, contentType);

  return {
    width,
    height,
    fps,
    duration: durationSec,
    bitrateKbps,
    aspectRatio: `${Math.round(width / divisor)}:${Math.round(height / divisor)}`,
    codec: videoTrack.codec_name || 'H.264',
    qualityScore: score,
    estimatedSourceScore: score,
    noiseLevel,
    compressionDamage,
    blurLevel,
    contentType,
    lossMetrics: {
      macroblockDamage: Number(macroblockDamage.toFixed(2)),
      chromaSubsamplingLoss,
      mosquitoNoise: Number(mosquitoNoise.toFixed(2)),
      blurRadius,
      textureDegradation: Number(textureDegradation.toFixed(2))
    },
    recommendedPreset,
    presetConfig,
    recommendedStrategy: {
      upscaleFactor,
      targetWidth,
      targetHeight,
      deblockStrength: presetConfig.deblockStrength,
      denoiseStrength: presetConfig.denoiseStrength,
      adaptiveSharpen: presetConfig.adaptiveSharpenStrength,
      modelProfile: recommendedPreset === 'REFERENCE_MATCH' ? 'faithful' : 'balanced'
    }
  };
}

export function getPresetConfig(preset: QualityPreset, macroblockDamage = 0.5, contentType: VideoContentType = 'real_life') {
  // Use real-life weights for photorealistic content, anime for synthetic/graphic content
  const modelWeightProfile: 'rl' | 'an' | '3d' = contentType === 'real_life' ? 'rl' : 'an';

  switch (preset) {
    case 'NATURAL':
      return {
        deblockStrength: 0.15,
        denoiseStrength: 0.10,
        temporalWindowSize: 3,
        faceProtectionWeight: 0.60,
        adaptiveSharpenStrength: 0.35,
        colorAnchoring: true,
        modelWeightProfile
      };
    case 'HIGH_DETAIL':
      return {
        deblockStrength: 0.05,
        denoiseStrength: 0.05,
        temporalWindowSize: 3,
        faceProtectionWeight: 0.30,
        adaptiveSharpenStrength: 0.75,
        colorAnchoring: true,
        modelWeightProfile
      };
    case 'REFERENCE_MATCH':
      return {
        deblockStrength: 0.10,
        denoiseStrength: 0.10,
        temporalWindowSize: 3,
        faceProtectionWeight: 0.45,
        adaptiveSharpenStrength: 0.50,
        colorAnchoring: true,
        modelWeightProfile
      };
    case 'BALANCED':
    default:
      return {
        deblockStrength: 0.12,
        denoiseStrength: 0.08,
        temporalWindowSize: 3,
        faceProtectionWeight: 0.50,
        adaptiveSharpenStrength: 0.55,
        colorAnchoring: true,
        modelWeightProfile
      };
  }
}