// Builds tiny Office files in memory for tests, so each test states exactly what the file contains.
import { strToU8, zipSync } from 'fflate';

const esc = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const zip = (files) => zipSync(Object.fromEntries(Object.entries(files).map(([name, text]) => [name, typeof text === 'string' ? strToU8(text) : text])));
const TYPES = (overrides) => `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${overrides}</Types>`;
const RELS = (items) => `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.map(([id, type, target, external]) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"${external ? ' TargetMode="External"' : ''}/>`).join('')}</Relationships>`;

/**
 * sheets: [{ name, cells: { A1: 5, B1: 'text', C1: { f: 'A1*2', v: 10 }, D1: { f: 'SUM(A1:A2)' }, E1: { f: 'A1/0', e: '#DIV/0!' } } }]
 * A formula without `v` or `e` has no stored result, as a generator that never calculated would write it.
 */
export function miniXlsx({ sheets, definedNames = [] }) {
  const files = {
    '[Content_Types].xml': TYPES(''),
    '_rels/.rels': RELS([['rId1', 'officeDocument', 'xl/workbook.xml']]),
    'xl/workbook.xml': `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((sheet, i) => `<sheet name="${esc(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>${definedNames.length ? `<definedNames>${definedNames.map(([name, ref]) => `<definedName name="${esc(name)}">${esc(ref)}</definedName>`).join('')}</definedNames>` : ''}</workbook>`,
    'xl/_rels/workbook.xml.rels': RELS(sheets.map((_sheet, i) => [`rId${i + 1}`, 'worksheet', `worksheets/sheet${i + 1}.xml`])),
  };
  sheets.forEach((sheet, i) => {
    const rows = new Map();
    for (const [ref, value] of Object.entries(sheet.cells ?? {})) {
      const row = Number(/\d+/.exec(ref)[0]);
      let xml;
      if (value !== null && typeof value === 'object') {
        const f = `<f>${esc(value.f)}</f>`;
        if ('e' in value) xml = `<c r="${ref}" t="e">${f}<v>${esc(value.e)}</v></c>`;
        else if (typeof value.v === 'string') xml = `<c r="${ref}" t="str">${f}<v>${esc(value.v)}</v></c>`;
        else if (value.v === undefined) xml = `<c r="${ref}">${f}<v></v></c>`;
        else xml = `<c r="${ref}">${f}<v>${value.v}</v></c>`;
      } else if (typeof value === 'string') xml = `<c r="${ref}" t="inlineStr"><is><t>${esc(value)}</t></is></c>`;
      else if (typeof value === 'boolean') xml = `<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`;
      else xml = `<c r="${ref}"><v>${value}</v></c>`;
      rows.set(row, [...(rows.get(row) ?? []), [ref, xml]]);
    }
    const col = (ref) => /[A-Z]+/.exec(ref)[0].split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
    const made = [...rows.keys()].sort((a, b) => a - b).map(row => `<row r="${row}">${rows.get(row).sort((a, b) => col(a[0]) - col(b[0])).map(item => item[1]).join('')}</row>`).join('');
    files[`xl/worksheets/sheet${i + 1}.xml`] = `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheet.rows ?? made}</sheetData>${sheet.after ?? ''}</worksheet>`;
  });
  return zip(files);
}

/** blocks: ['plain paragraph', { h: 1, text }, { table: [['a','b'],['c','d']] }, { image: 'missing' | 'present' }] */
export function miniDocx({ blocks, comments = 0 }) {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
  const para = (text, style) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
  const rels = [['rIdS', 'styles', 'styles.xml']];
  const files = {};
  let images = 0;
  const body = blocks.map(block => {
    if (typeof block === 'string') return para(block);
    if (block.h) return para(block.text, `Heading${block.h}`);
    if (block.table) return `<w:tbl>${block.table.map(row => `<w:tr>${row.map(cell => `<w:tc>${para(cell)}</w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>`;
    if (block.image) {
      const id = `rIdImg${++images}`;
      rels.push([id, 'image', `media/image${images}.png`]);
      if (block.image === 'present') files[`word/media/image${images}.png`] = new Uint8Array([137, 80, 78, 71]);
      return `<w:p><w:r><w:drawing><wp:inline><wp:docPr id="${images}" name="Picture"/><a:graphic><a:graphicData><a:blip r:embed="${id}"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
    }
    return '';
  }).join('');
  if (comments) { rels.push(['rIdC', 'comments', 'comments.xml']); files['word/comments.xml'] = `<?xml version="1.0"?><w:comments ${W}>${Array.from({ length: comments }, (_x, i) => `<w:comment w:id="${i}"><w:p><w:r><w:t>note</w:t></w:r></w:p></w:comment>`).join('')}</w:comments>`; }
  return zip({
    '[Content_Types].xml': TYPES(''),
    '_rels/.rels': RELS([['rId1', 'officeDocument', 'word/document.xml']]),
    'word/document.xml': `<?xml version="1.0"?><w:document ${W}><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`,
    'word/styles.xml': `<?xml version="1.0"?><w:styles ${W}>${[1, 2, 3, 4].map(n => `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/></w:style>`).join('')}</w:styles>`,
    'word/_rels/document.xml.rels': RELS(rels),
    ...files,
  });
}

/**
 * slides: [[{ text, x, y, w, h, size, ph }, { picture: 'missing' | 'present', x, y, w, h }]]; positions in inches on a 10 x 5.625 in slide.
 */
export function miniPptx({ slides, width = 10, height = 5.625 }) {
  const P = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
  const emu = (inch) => Math.round(inch * 914400);
  const files = {
    '[Content_Types].xml': TYPES(''),
    '_rels/.rels': RELS([['rId1', 'officeDocument', 'ppt/presentation.xml']]),
    'ppt/presentation.xml': `<?xml version="1.0"?><p:presentation ${P}><p:sldIdLst>${slides.map((_s, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`).join('')}</p:sldIdLst><p:sldSz cx="${emu(width)}" cy="${emu(height)}"/></p:presentation>`,
    'ppt/_rels/presentation.xml.rels': RELS(slides.map((_s, i) => [`rId${i + 1}`, 'slide', `slides/slide${i + 1}.xml`])),
  };
  slides.forEach((shapes, i) => {
    const rels = [];
    const body = shapes.map((shape, k) => {
      const xfrm = shape.x === undefined ? '' : `<a:xfrm><a:off x="${emu(shape.x)}" y="${emu(shape.y)}"/><a:ext cx="${emu(shape.w)}" cy="${emu(shape.h)}"/></a:xfrm>`;
      if (shape.picture) {
        const id = `rIdP${k}`;
        rels.push([id, 'image', `../media/s${i}p${k}.png`]);
        if (shape.picture === 'present') files[`ppt/media/s${i}p${k}.png`] = new Uint8Array([137, 80, 78, 71]);
        return `<p:pic><p:nvPicPr><p:cNvPr id="${k + 2}" name="Picture ${k + 1}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${id}"/></p:blipFill><p:spPr>${xfrm}</p:spPr></p:pic>`;
      }
      const runs = String(shape.text ?? '').split('\n').map(line => `<a:p><a:r><a:rPr lang="en-US"${shape.size ? ` sz="${shape.size * 100}"` : ''}/><a:t>${esc(line)}</a:t></a:r></a:p>`).join('');
      return `<p:sp><p:nvSpPr><p:cNvPr id="${k + 2}" name="${esc(shape.name ?? `Box ${k + 1}`)}"/><p:cNvSpPr/><p:nvPr>${shape.ph ? `<p:ph type="${shape.ph}"/>` : ''}</p:nvPr></p:nvSpPr><p:spPr>${xfrm}</p:spPr><p:txBody><a:bodyPr/>${shape.text === undefined || shape.text === '' ? '<a:p/>' : runs}</p:txBody></p:sp>`;
    }).join('');
    files[`ppt/slides/slide${i + 1}.xml`] = `<?xml version="1.0"?><p:sld ${P}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${body}</p:spTree></p:cSld></p:sld>`;
    files[`ppt/slides/_rels/slide${i + 1}.xml.rels`] = RELS(rels);
  });
  return zip(files);
}
