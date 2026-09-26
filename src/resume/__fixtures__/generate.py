#!/usr/bin/env python3
"""Regenerate the résumé parser test fixtures (deterministic, stdlib only).

    python3 src/resume/__fixtures__/generate.py

- resume.docx     minimal WordprocessingML: heading style, soft line break, empty paragraph,
                  a table row, nested bullet list, numbered list, tab, split runs, XML entities.
- simple.pdf      2 pages, Helvetica/Courier (no embedded fonts): header, same-baseline fields
                  with a wide gap, a word split across two text objects, page-number footers.
- cmap-zh.pdf     Chinese text in a non-embedded Type0 font using the predefined UniGB-UCS2-H
                  CMap (needs pdf.js' bundled CMaps to decode).
two-column-zh.pdf is produced by Chromium (see generate-chromium-pdf.mjs).
"""
import os
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))

# ─────────────────────────── DOCX ───────────────────────────
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

CONTENT_TYPES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
</Types>"""

ROOT_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"""

DOC_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
</Relationships>"""

STYLES = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="{W}">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/></w:style>
</w:styles>"""

NUMBERING = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="{W}">
  <w:abstractNum w:abstractNumId="0">
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/></w:lvl>
    <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="o"/></w:lvl>
  </w:abstractNum>
  <w:abstractNum w:abstractNumId="1">
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>
  </w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
  <w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>"""


def run(text):
    return f'<w:r><w:t xml:space="preserve">{text}</w:t></w:r>'


def para(inner='', style=None, num=None):
    ppr = ''
    if style or num:
        ppr = '<w:pPr>'
        if style:
            ppr += f'<w:pStyle w:val="{style}"/>'
        if num:
            ppr += f'<w:numPr><w:ilvl w:val="{num[1]}"/><w:numId w:val="{num[0]}"/></w:numPr>'
        ppr += '</w:pPr>'
    return f'<w:p>{ppr}{inner}</w:p>'


def cell(text):
    return f'<w:tc><w:tcPr><w:tcW w:w="4500" w:type="dxa"/></w:tcPr>{para(run(text))}</w:tc>'


BODY = ''.join([
    para(run('李雷 Li Lei'), style='Heading1'),
    para(run('电话：139-0000-0000') + '<w:r><w:br/></w:r>' + run('邮箱：lilei@example.com')),
    para(),
    para(run('工作经历'), style='Heading1'),
    '<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="4500"/><w:gridCol w:w="4500"/></w:tblGrid>'
    f'<w:tr>{cell("星河云科技 · 后端开发实习生")}{cell("2025.06 – 2025.12")}</w:tr></w:tbl>',
    para(run('负责订单服务重构，峰值 QPS 提升 3 倍'), style='ListParagraph', num=(1, 0)),
    para(run('使用 Go &amp; Redis &lt;cache&gt;'), style='ListParagraph', num=(1, 1)),
    para(run('First achievement'), style='ListParagraph', num=(2, 0)),
    para(run('Second achievement'), style='ListParagraph', num=(2, 0)),
    para(run('Skills:') + '<w:r><w:tab/></w:r>' + run('Go, TypeScript')),
    para(run('Hel') + run('lo world')),
])

DOCUMENT = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="{W}"><w:body>{BODY}<w:sectPr/></w:body></w:document>"""


def write_docx(path):
    fixed = (2024, 1, 1, 0, 0, 0)
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as z:
        for name, data in [
            ('[Content_Types].xml', CONTENT_TYPES),
            ('_rels/.rels', ROOT_RELS),
            ('word/_rels/document.xml.rels', DOC_RELS),
            ('word/document.xml', DOCUMENT),
            ('word/styles.xml', STYLES),
            ('word/numbering.xml', NUMBERING),
        ]:
            info = zipfile.ZipInfo(name, fixed)
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, data.encode('utf-8'))


# ─────────────────────────── PDF ───────────────────────────

def write_pdf(path, pages, fonts):
    """pages: list of content-stream strings; fonts: list of (resource name, [font object dicts...])."""
    objs = {}
    next_id = [1]

    def alloc():
        n = next_id[0]
        next_id[0] += 1
        return n

    catalog, pages_id = alloc(), alloc()
    font_refs = {}
    for name, chain in fonts:
        ids = [alloc() for _ in chain]
        for i, body in enumerate(chain):
            body = body.replace('{next}', f'{ids[i + 1]} 0 R' if i + 1 < len(ids) else '')
            body = body.replace('{next2}', f'{ids[i + 2]} 0 R' if i + 2 < len(ids) else '')
            objs[ids[i]] = body.encode('latin-1')
        font_refs[name] = ids[0]
    resources = '<< /Font << ' + ' '.join(f'/{n} {i} 0 R' for n, i in font_refs.items()) + ' >> >>'
    kids = []
    for content in pages:
        page_id, content_id = alloc(), alloc()
        data = content.encode('latin-1')
        objs[content_id] = b'<< /Length %d >>\nstream\n' % len(data) + data + b'\nendstream'
        objs[page_id] = (f'<< /Type /Page /Parent {pages_id} 0 R /MediaBox [0 0 612 792] '
                         f'/Contents {content_id} 0 R /Resources {resources} >>').encode('latin-1')
        kids.append(page_id)
    objs[catalog] = f'<< /Type /Catalog /Pages {pages_id} 0 R >>'.encode('latin-1')
    objs[pages_id] = (f'<< /Type /Pages /Kids [{" ".join(f"{k} 0 R" for k in kids)}] /Count {len(kids)} >>').encode('latin-1')

    out = bytearray(b'%PDF-1.4\n%\xe2\xe3\xcf\xd3\n')
    offsets = {}
    for n in sorted(objs):
        offsets[n] = len(out)
        out += b'%d 0 obj\n' % n + objs[n] + b'\nendobj\n'
    xref = len(out)
    size = max(objs) + 1
    out += b'xref\n0 %d\n0000000000 65535 f \n' % size
    for n in range(1, size):
        out += b'%010d 00000 n \n' % offsets[n]
    out += b'trailer\n<< /Size %d /Root %d 0 R >>\nstartxref\n%d\n%%%%EOF\n' % (size, catalog, xref)
    with open(path, 'wb') as f:
        f.write(out)


def text(font, size, x, y, s):
    s = s.replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)')
    return f'BT /{font} {size} Tf {x} {y} Td ({s}) Tj ET\n'


LATIN_FONTS = [
    ('F1', ['<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>']),
    ('F2', ['<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>']),
]

# Courier: every glyph is 0.6 em wide → 6 pt at 10 pt.
PAGE1 = ''.join([
    text('F1', 20, 72, 740, 'Jane Doe'),
    text('F2', 10, 72, 716, 'Software Engineer'),
    text('F2', 10, 400, 716, 'jane@example.com'),
    text('F1', 12, 72, 680, 'EXPERIENCE'),
    text('F2', 10, 72, 662, 'Acme Corp'),
    text('F2', 10, 450, 662, '2019 - 2021'),
    text('F2', 10, 72, 648, 'Built a pay'),          # 11 chars → ends at x = 138
    text('F2', 10, 138, 648, 'ments system'),         # glued: "payments"
    text('F2', 10, 72, 634, 'Cut latency by'),        # 14 chars → ends at x = 156
    text('F2', 10, 159, 634, '40%'),                  # 3 pt gap → a space
    text('F2', 10, 300, 40, '1 / 2'),
])
PAGE2 = ''.join([
    text('F1', 12, 72, 740, 'EDUCATION'),
    text('F2', 10, 72, 722, 'State University'),
    text('F2', 10, 450, 722, '2015 - 2019'),
    text('F2', 10, 300, 40, '2 / 2'),
])

CJK_FONTS = [
    ('F1', [
        '<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [{next}] >>',
        '<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light '
        '/CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> /FontDescriptor {next} /DW 1000 >>',
        '<< /Type /FontDescriptor /FontName /STSong-Light /Flags 6 /FontBBox [-25 -254 1000 880] '
        '/ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 880 /StemV 93 >>',
    ]),
]


def ucs2(s):
    return ''.join('%04X' % ord(c) for c in s)


def hex_text(size, x, y, s):
    return f'BT /F1 {size} Tf {x} {y} Td <{ucs2(s)}> Tj ET\n'


CJK_PAGE = ''.join([
    hex_text(18, 72, 720, '王小红'),
    hex_text(12, 72, 690, '前端开发'),     # 4 glyphs × 12 pt → ends at x = 120
    hex_text(12, 120, 690, '工程师'),      # glued → "前端开发工程师"
    hex_text(12, 72, 670, '熟悉 React 与 TypeScript'),
])

if __name__ == '__main__':
    write_docx(os.path.join(HERE, 'resume.docx'))
    write_pdf(os.path.join(HERE, 'simple.pdf'), [PAGE1, PAGE2], LATIN_FONTS)
    write_pdf(os.path.join(HERE, 'cmap-zh.pdf'), [CJK_PAGE], CJK_FONTS)
    print('fixtures written to', HERE)
