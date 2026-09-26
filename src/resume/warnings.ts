/**
 * Résumé warnings are machine-readable strings `"<code>"` or `"<code>:<detail>"` (see
 * {@link RESUME_WARNING}); use {@link describeResumeWarning} to turn them into UI text in either
 * language. Unknown strings are passed through unchanged, so plain-text warnings still display.
 */
import type { Lang, Localized } from '../types';
import { isResumeParseError, type ResumeErrorReason, type ResumeParseErrorCode } from './errors';

export const RESUME_WARNING = {
  /** Text was cut to MAX_RESUME_CHARS. Detail: original length in characters. */
  truncated: 'truncated',
  /** Very little text found (probably a scanned document). Detail: content characters found. */
  littleText: 'little_text',
  /** Some PDF pages had no selectable text. Detail: number of such pages. */
  scannedPages: 'scanned_pages',
  /** Only the first N pages were read. Detail: "read/total". */
  pagesLimited: 'pages_limited',
  /** Some PDF pages failed to parse. Detail: number of failed pages. */
  pageErrors: 'page_errors',
  /** A non-UTF-8 text encoding was detected and used. Detail: encoding name. */
  encoding: 'encoding',
  /** Undecodable bytes were replaced with "�". Detail: count. */
  replacementChars: 'replacement_chars',
} as const;

export type ResumeWarningCode = (typeof RESUME_WARNING)[keyof typeof RESUME_WARNING];

const CODES = new Set<string>(Object.values(RESUME_WARNING));

export function formatResumeWarning(code: ResumeWarningCode, detail?: string | number): string {
  return detail === undefined || detail === '' ? code : `${code}:${detail}`;
}

export function parseResumeWarning(warning: string): { code: ResumeWarningCode; detail: string } | null {
  const sep = warning.indexOf(':');
  const code = sep === -1 ? warning : warning.slice(0, sep);
  if (!CODES.has(code)) return null;
  return { code: code as ResumeWarningCode, detail: sep === -1 ? '' : warning.slice(sep + 1) };
}

function num(detail: string, lang: Lang): string {
  const n = Number(detail);
  return Number.isFinite(n) ? n.toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US') : detail;
}

const ENCODING_NAMES: Readonly<Record<string, Localized>> = {
  gb18030: { zh: 'GBK/GB18030', en: 'GBK/GB18030 (Chinese)' },
  'utf-16le': { zh: 'UTF-16', en: 'UTF-16' },
  'utf-16be': { zh: 'UTF-16', en: 'UTF-16' },
};

/** Localized, human-readable text for a warning produced by the résumé parser. */
export function describeResumeWarning(warning: string, lang: Lang): string {
  const parsed = parseResumeWarning(warning);
  if (!parsed) return warning;
  const { code, detail } = parsed;
  const zh = lang === 'zh';
  switch (code) {
    case 'truncated':
      return zh
        ? `简历较长（${num(detail, lang)} 字），只保留了前面的部分，可在下方手动精简。`
        : `The résumé is long (${num(detail, lang)} characters); only the first part is kept. You can trim it below.`;
    case 'little_text':
      return zh
        ? '只识别到很少的文字，可能是扫描件或图片版简历。建议上传可复制文字的 PDF/DOCX，或直接粘贴文本。'
        : 'Very little text was found — this may be a scanned or image-only résumé. Try a text-based PDF/DOCX or paste the text.';
    case 'scanned_pages':
      return zh
        ? `有 ${num(detail, lang)} 页没有可识别的文字（可能是图片），这些页面的内容未被读取。`
        : `${num(detail, lang)} page(s) contain no selectable text (images?) and were skipped.`;
    case 'pages_limited': {
      const [read, total] = detail.split('/');
      return zh
        ? `文件共 ${total ?? '?'} 页，只读取了前 ${read ?? '?'} 页。`
        : `The file has ${total ?? '?'} pages; only the first ${read ?? '?'} were read.`;
    }
    case 'page_errors':
      return zh ? `有 ${num(detail, lang)} 页解析失败，内容可能不完整。` : `${num(detail, lang)} page(s) could not be read; the text may be incomplete.`;
    case 'encoding': {
      const name = ENCODING_NAMES[detail]?.[lang] ?? detail;
      return zh ? `已按 ${name} 编码读取该文本文件。` : `The text file was read using the ${name} encoding.`;
    }
    case 'replacement_chars':
      return zh
        ? `有 ${num(detail, lang)} 个字符无法识别（显示为 �），请检查文件编码或手动修正。`
        : `${num(detail, lang)} character(s) could not be decoded (shown as �). Check the file encoding or fix them by hand.`;
  }
}

const ERROR_TEXT: Readonly<Record<ResumeParseErrorCode, Localized>> = {
  unsupported: {
    zh: '不支持这种文件格式。请上传 PDF、DOCX、TXT 或 Markdown，或直接粘贴简历文本。',
    en: 'This file type is not supported. Upload a PDF, DOCX, TXT or Markdown file, or paste the text.',
  },
  empty: {
    zh: '没有在文件里找到文字。如果是扫描件或图片，请直接粘贴简历文本。',
    en: 'No text was found in the file. If it is a scan or an image, please paste the text instead.',
  },
  too_large: {
    zh: '文件太大了（上限 10 MB）。请压缩图片后重新导出，或直接粘贴文本。',
    en: 'The file is too large (max 10 MB). Re-export it with smaller images, or paste the text.',
  },
  corrupt: {
    zh: '文件无法读取，可能已损坏。请重新导出后再试，或直接粘贴文本。',
    en: 'The file could not be read — it may be damaged. Re-export it and try again, or paste the text.',
  },
};

const REASON_TEXT: Readonly<Partial<Record<ResumeErrorReason, Localized>>> = {
  legacy_doc: {
    zh: '这是旧版 Word 文档（.doc）。请在 Word / WPS 中“另存为” .docx 或 PDF 后再上传。',
    en: 'This is a legacy Word document (.doc). Please “Save as” .docx or PDF in Word and upload again.',
  },
  image: {
    zh: '暂不支持图片格式的简历。请上传 PDF / DOCX，或直接粘贴文本。',
    en: 'Image résumés are not supported. Upload a PDF / DOCX, or paste the text.',
  },
  other_document: {
    zh: '暂不支持该文档格式。请导出为 PDF 或 DOCX 后再上传，或直接粘贴文本。',
    en: 'This document format is not supported. Export it as PDF or DOCX, or paste the text.',
  },
  wrong_format: {
    zh: '文件内容与扩展名不符，可能已损坏或被改过扩展名。请重新导出后再试。',
    en: 'The file contents do not match its extension — it may be damaged or renamed. Please re-export it.',
  },
  encrypted: {
    zh: '这个 PDF 设置了密码保护，无法读取。请导出一个无密码的版本。',
    en: 'This PDF is password-protected. Please export an unprotected copy.',
  },
  no_text: {
    zh: '这个 PDF 里没有可复制的文字（可能是扫描件）。请上传文字版，或直接粘贴简历文本。',
    en: 'This PDF has no selectable text (probably a scan). Upload a text-based version or paste the text.',
  },
  timeout: {
    zh: '解析时间过长，已中止。请尝试精简后的文件，或直接粘贴文本。',
    en: 'Parsing took too long and was stopped. Try a simpler file, or paste the text.',
  },
  engine: {
    zh: '文档解析组件加载失败（可能是网络中断）。请刷新页面后重试，或直接粘贴文本。',
    en: 'The document reader failed to load (network hiccup?). Refresh the page and try again, or paste the text.',
  },
  read_failed: {
    zh: '浏览器无法读取这个文件，请确认文件仍然存在后重试。',
    en: 'The browser could not read this file. Make sure it still exists and try again.',
  },
};

/** Localized, user-friendly explanation for any error thrown by `parseResumeFile`. */
export function describeResumeError(error: unknown, lang: Lang): string {
  if (isResumeParseError(error)) {
    const byReason = error.reason ? REASON_TEXT[error.reason] : undefined;
    return (byReason ?? ERROR_TEXT[error.code])[lang];
  }
  return ERROR_TEXT.corrupt[lang];
}
