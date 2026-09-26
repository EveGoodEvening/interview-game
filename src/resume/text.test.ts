import { describe, expect, it } from 'vitest';
import { decodeTextBytes } from './text';

const hex = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (b) => parseInt(b, 16));
const utf8 = (s: string) => new TextEncoder().encode(s);

function utf16le(s: string, bom: boolean): Uint8Array {
  const out = new Uint8Array((bom ? 2 : 0) + s.length * 2);
  let o = 0;
  if (bom) {
    out[o++] = 0xff;
    out[o++] = 0xfe;
  }
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out[o++] = c & 0xff;
    out[o++] = c >> 8;
  }
  return out;
}

/** "张晓明 后端工程师 熟悉 Go 与 Redis，负责订单系统。GPA：3.8" encoded as GB18030/GBK. */
const GBK_SAMPLE = hex(
  'd5c5cffec3f720baf3b6cbb9a4b3cccaa620caeccfa420476f20d3eb205265646973a3acb8bad4f0b6a9b5a5cfb5cdb3a1a3475041a3ba332e38',
);
const GBK_TEXT = '张晓明 后端工程师 熟悉 Go 与 Redis，负责订单系统。GPA：3.8';

describe('decodeTextBytes', () => {
  it('decodes plain UTF-8', () => {
    expect(decodeTextBytes(utf8('简历 Résumé'))).toEqual({ text: '简历 Résumé', encoding: 'utf-8', replacementCount: 0 });
  });

  it('strips a UTF-8 BOM', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8('张三')]);
    expect(decodeTextBytes(bytes).text).toBe('张三');
  });

  it('falls back to GB18030 for GBK-encoded Chinese text', () => {
    const result = decodeTextBytes(GBK_SAMPLE);
    expect(result).toEqual({ text: GBK_TEXT, encoding: 'gb18030', replacementCount: 0 });
  });

  it('keeps UTF-8 when there is only a stray invalid byte', () => {
    const bytes = new Uint8Array([...utf8('熟悉 Go 与 Redis，负责订单系统'), 0xff, ...utf8(' done')]);
    const result = decodeTextBytes(bytes);
    expect(result.encoding).toBe('utf-8');
    expect(result.replacementCount).toBe(1);
    expect(result.text.startsWith('熟悉 Go')).toBe(true);
  });

  it('decodes UTF-16LE with and without BOM', () => {
    expect(decodeTextBytes(utf16le('Alex Chen, frontend engineer', true))).toMatchObject({
      text: 'Alex Chen, frontend engineer',
      encoding: 'utf-16le',
    });
    expect(decodeTextBytes(utf16le('Alex Chen, frontend engineer', false))).toMatchObject({
      text: 'Alex Chen, frontend engineer',
      encoding: 'utf-16le',
    });
  });

  it('handles empty input', () => {
    expect(decodeTextBytes(new Uint8Array())).toEqual({ text: '', encoding: 'utf-8', replacementCount: 0 });
  });
});
