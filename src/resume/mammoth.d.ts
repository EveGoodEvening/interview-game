/**
 * Minimal typings for mammoth's self-contained browser bundle (the package only types its Node
 * entry). The bundle is a UMD/CommonJS module: bundlers and Node expose it as the default export.
 */
declare module 'mammoth/mammoth.browser.js' {
  export interface MammothMessage {
    type: 'warning' | 'error';
    message: string;
  }

  export interface MammothResult {
    value: string;
    messages: MammothMessage[];
  }

  /** Opaque image converter created by `images.imgElement`. */
  export interface MammothImageConverter {
    readonly __mammothBrand: 'ImageConverter';
  }

  export interface MammothOptions {
    styleMap?: string | string[];
    includeDefaultStyleMap?: boolean;
    ignoreEmptyParagraphs?: boolean;
    convertImage?: MammothImageConverter;
    externalFileAccess?: boolean;
  }

  export interface Mammoth {
    convertToHtml(input: { arrayBuffer: ArrayBuffer }, options?: MammothOptions): Promise<MammothResult>;
    extractRawText(input: { arrayBuffer: ArrayBuffer }): Promise<MammothResult>;
    images: {
      imgElement(convert: (image: { contentType: string }) => Promise<Record<string, string>>): MammothImageConverter;
    };
  }

  const mammoth: Mammoth;
  export default mammoth;
}
