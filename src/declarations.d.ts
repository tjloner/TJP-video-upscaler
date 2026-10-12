declare var require: any;

declare module 'upscaler' {
  const Upscaler: any;
  export default Upscaler;
}

declare module '@upscalerjs/default-model' {
  const DefaultModel: any;
  export default DefaultModel;
}

declare module '@websr/websr' {
  export default class WebSR {
    constructor(options: any);
    render(source: any): Promise<void>;
    static initWebGPU(): Promise<any>;
  }
}

declare module 'web-demuxer' {
  export class WebDemuxer {
    constructor(options?: any);
    load(file: any): Promise<void>;
    getMediaInfo(): Promise<any>;
    getDecoderConfig(trackType: string): Promise<any>;
    read(trackType: string, index?: number): any;
  }
}

declare module 'mediabunny' {
  export const Output: any;
  export const Mp4OutputFormat: any;
  export const StreamTarget: any;
  export const EncodedVideoPacketSource: any;
  export const EncodedAudioPacketSource: any;
  export const EncodedPacket: any;
}

declare module './lib/image-compare-viewer.min' {
  const ImageCompare: any;
  export default ImageCompare;
}

declare module '*.json' {
  const value: any;
  export default value;
}
declare module '*.css';