import { describe, expect, it } from 'vitest';
import { classifyDeclared, fileExtension, resolveKind, sniffBytes } from './detect';
import { ResumeParseError } from './errors';

const ascii = (s: string) => new TextEncoder().encode(s);
const PDF = ascii('%PDF-1.7\n%...');
const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00]);
const OLE = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const TEXT = ascii('Alex Chen\nFrontend engineer\n');
const BINARY = new Uint8Array([0x01, 0x02, 0x00, 0x03, 0x04, 0x00, 0x05, 0x06, 0x07, 0x00, 0x08, 0x10]);

function errorOf(fn: () => unknown): ResumeParseError {
  try {
    fn();
  } catch (error) {
    if (error instanceof ResumeParseError) return error;
    throw error;
  }
  throw new Error('expected a ResumeParseError');
}

describe('fileExtension', () => {
  it('extracts lower-case extensions', () => {
    expect(fileExtension('My Résumé.PDF')).toBe('pdf');
    expect(fileExtension('C:\\docs\\cv.v2.docx')).toBe('docx');
    expect(fileExtension('.bashrc')).toBe('');
    expect(fileExtension('README')).toBe('');
  });
});

describe('classifyDeclared', () => {
  it('uses extension first, then MIME type', () => {
    expect(classifyDeclared('cv.md', '')).toEqual({ kind: 'text' });
    expect(classifyDeclared('cv', 'application/pdf')).toEqual({ kind: 'pdf' });
    expect(classifyDeclared('cv', 'text/plain; charset=utf-8')).toEqual({ kind: 'text' });
    expect(classifyDeclared('cv.doc', '')).toEqual({ kind: 'unsupported', reason: 'legacy_doc' });
    expect(classifyDeclared('photo', 'image/jpeg')).toEqual({ kind: 'unsupported', reason: 'image' });
    expect(classifyDeclared('cv.bin', 'application/octet-stream')).toEqual({ kind: 'unknown' });
  });
});

describe('sniffBytes', () => {
  it('recognises magic numbers', () => {
    expect(sniffBytes(PDF)).toBe('pdf');
    expect(sniffBytes(new Uint8Array([0x0a, 0x0a, ...PDF]))).toBe('pdf');
    expect(sniffBytes(ZIP)).toBe('zip');
    expect(sniffBytes(OLE)).toBe('ole');
    expect(sniffBytes(PNG)).toBe('image');
    expect(sniffBytes(ascii('{\\rtf1\\ansi'))).toBe('rtf');
    expect(sniffBytes(TEXT)).toBe('text');
    expect(sniffBytes(BINARY)).toBe('binary');
  });
});

describe('resolveKind', () => {
  it('reads what the bytes say, even when renamed', () => {
    expect(resolveKind('cv.pdf', 'application/pdf', PDF)).toBe('pdf');
    expect(resolveKind('cv.txt', 'text/plain', PDF)).toBe('pdf');
    expect(resolveKind('cv.docx', '', ZIP)).toBe('docx');
    expect(resolveKind('download', '', ZIP)).toBe('docx');
    expect(resolveKind('notes.md', '', TEXT)).toBe('text');
    expect(resolveKind('resume', '', TEXT)).toBe('text');
  });

  it('rejects legacy Word files, including .doc renamed to .docx', () => {
    expect(errorOf(() => resolveKind('cv.doc', 'application/msword', OLE))).toMatchObject({
      code: 'unsupported',
      reason: 'legacy_doc',
    });
    expect(errorOf(() => resolveKind('cv.docx', '', OLE))).toMatchObject({ code: 'unsupported', reason: 'legacy_doc' });
  });

  it('rejects images and other formats', () => {
    expect(errorOf(() => resolveKind('cv.png', 'image/png', PNG))).toMatchObject({ code: 'unsupported', reason: 'image' });
    expect(errorOf(() => resolveKind('cv.txt', 'text/plain', PNG))).toMatchObject({ code: 'unsupported', reason: 'image' });
    expect(errorOf(() => resolveKind('cv.xlsx', '', ZIP))).toMatchObject({ code: 'unsupported', reason: 'binary' });
    expect(errorOf(() => resolveKind('cv.rtf', '', ascii('{\\rtf1')))).toMatchObject({
      code: 'unsupported',
      reason: 'other_document',
    });
    expect(errorOf(() => resolveKind('cv.txt', '', BINARY))).toMatchObject({ code: 'unsupported', reason: 'binary' });
    expect(errorOf(() => resolveKind('cv.txt', '', ZIP))).toMatchObject({ code: 'unsupported', reason: 'binary' });
  });

  it('flags files whose content does not match the extension', () => {
    expect(errorOf(() => resolveKind('cv.pdf', 'application/pdf', TEXT))).toMatchObject({
      code: 'corrupt',
      reason: 'wrong_format',
    });
    expect(errorOf(() => resolveKind('cv.docx', '', TEXT))).toMatchObject({ code: 'corrupt', reason: 'wrong_format' });
  });
});
