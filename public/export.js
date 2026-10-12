// Report files made in the browser: CSV, Excel (.xlsx), Word (.docx), PDF, and a .zip when several are chosen.
// Nothing is sent anywhere: the data is already on this screen. The file writers are small and self-contained.
(function (root) {
  const enc = new TextEncoder();
  const u8 = (s) => (typeof s === 'string' ? enc.encode(s) : s);
  const esc = (v) => String(v ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const show = (v, col) => (v == null || v === '' ? '' : col && col.type === 'pct' && isNum(v) ? v + '%' : String(v));

  // ---- zip (stored, no compression) ----
  let CRC = null;
  function crc32(b) { if (!CRC) { CRC = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; } } let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
  function zip(files) {
    const parts = [], central = []; let offset = 0;
    const d = new Date(); const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    for (const f of files) {
      const name = u8(f.name), data = u8(f.data), crc = crc32(data);
      const h = new DataView(new ArrayBuffer(30)); h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true); h.setUint16(10, dosTime, true); h.setUint16(12, dosDate, true); h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
      parts.push(new Uint8Array(h.buffer), name, data);
      const c = new DataView(new ArrayBuffer(46)); c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true); c.setUint16(12, dosTime, true); c.setUint16(14, dosDate, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
      central.push(new Uint8Array(c.buffer), name); offset += 30 + name.length + data.length;
    }
    const csize = central.reduce((n, p) => n + p.length, 0);
    const e = new DataView(new ArrayBuffer(22)); e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, csize, true); e.setUint32(16, offset, true);
    const all = [...parts, ...central, new Uint8Array(e.buffer)]; const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of all) { out.set(p, o); o += p.length; } return out;
  }

  // ---- CSV (UTF-8 with a byte-order mark so Excel opens it correctly) ----
  function csv(rep) {
    const q = (v) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const lines = [rep.columns.map((c) => q(c.label)).join(',')];
    for (const r of rep.rows) lines.push(rep.columns.map((c) => q(r[c.k] ?? '')).join(','));
    return '﻿' + lines.join('\r\n') + '\r\n';
  }

  // ---- Excel ----
  const colName = (i) => { let s = ''; for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };
  function xlsx(rep) {
    const cell = (ref, v, style, col) => (isNum(v) ? `<c r="${ref}"${style ? ` s="${style}"` : ''}><v>${v}</v></c>` : v == null || v === '' ? '' : `<c r="${ref}" t="inlineStr"${style ? ` s="${style}"` : ''}><is><t xml:space="preserve">${esc(show(v, col))}</t></is></c>`);
    const widths = rep.columns.map((c) => Math.min(48, Math.max(c.label.length + 2, ...rep.rows.slice(0, 200).map((r) => String(r[c.k] ?? '').length + 2), 8)));
    const dataRows = [`<row r="1" ht="30" customHeight="1">${rep.columns.map((c, i) => cell(colName(i) + '1', c.label, 1)).join('')}</row>`];
    rep.rows.forEach((r, ri) => dataRows.push(`<row r="${ri + 2}">${rep.columns.map((c, i) => cell(colName(i) + (ri + 2), r[c.k], 0, c)).join('')}</row>`));
    const last = colName(Math.max(0, rep.columns.length - 1)) + (rep.rows.length + 1);
    const dataSheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${dataRows.join('')}</sheetData><autoFilter ref="A1:${last}"/></worksheet>`;
    const about = [[rep.title, 2], [rep.subtitle || '', 0], ['', 0], ...(rep.kpis || []).map((k) => [`${k.label}: ${k.value}`, 0]), ['', 0], ...(rep.headline ? [['Headline', 2], [rep.headline, 3]] : []), ...(rep.notes ? [['Notes', 2], ...String(rep.notes).split('\n').map((l) => [l, 3])] : []), ['', 0], [rep.footer || '', 0]];
    const aboutSheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols><col min="1" max="1" width="110" customWidth="1"/></cols><sheetData>${about.map(([t, s], i) => `<row r="${i + 1}">${t ? `<c r="A${i + 1}" t="inlineStr" s="${s}"><is><t xml:space="preserve">${esc(t)}</t></is></c>` : ''}</row>`).join('')}</sheetData></worksheet>`;
    const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="12"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF354062"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment wrapText="1" vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
    return zip([
      { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>` },
      { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
      { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/><sheet name="Report" sheetId="2" r:id="rId2"/></sheets></workbook>` },
      { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
      { name: 'xl/styles.xml', data: styles }, { name: 'xl/worksheets/sheet1.xml', data: dataSheet }, { name: 'xl/worksheets/sheet2.xml', data: aboutSheet },
    ]);
  }

  // ---- Word ----
  function docx(rep) {
    const run = (t, o = {}) => `<w:r><w:rPr>${o.b ? '<w:b/>' : ''}${o.color ? `<w:color w:val="${o.color}"/>` : ''}<w:sz w:val="${o.sz || 20}"/></w:rPr><w:t xml:space="preserve">${esc(t)}</w:t></w:r>`;
    const para = (t, o = {}) => `<w:p><w:pPr><w:spacing w:after="${o.after ?? 100}"/></w:pPr>${run(t, o)}</w:p>`;
    const n = rep.columns.length, w = Math.floor(15400 / Math.max(1, n));
    const small = n > 8 ? 14 : n > 5 ? 16 : 18;
    const tc = (t, hdr, c) => `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${hdr ? '<w:shd w:val="clear" w:color="auto" w:fill="354062"/>' : ''}</w:tcPr><w:p><w:pPr><w:spacing w:after="0"/>${!hdr && c && (c.type === 'num' || c.type === 'pct') ? '<w:jc w:val="right"/>' : ''}</w:pPr>${run(t, { b: hdr, color: hdr ? 'FFFFFF' : '', sz: small })}</w:p></w:tc>`;
    const borders = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((s) => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="BFC5D2"/>`).join('');
    const table = `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${borders}</w:tblBorders><w:tblLayout w:type="autofit"/><w:tblCellMar><w:left w:w="60" w:type="dxa"/><w:right w:w="60" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${rep.columns.map(() => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid><w:tr><w:trPr><w:tblHeader/></w:trPr>${rep.columns.map((c) => tc(c.label, true)).join('')}</w:tr>${rep.rows.map((r, i) => `<w:tr>${rep.columns.map((c) => tc(show(r[c.k], c), false, c)).join('')}</w:tr>`).join('')}</w:tbl>`;
    const kp = (rep.kpis || []).map((k) => `${k.label}: ${k.value}`).join('   ·   ');
    const body = [para(rep.title, { b: true, color: '354062', sz: 40, after: 60 }), para(rep.subtitle || '', { color: '5A6478', sz: 20 }), kp ? para(kp, { b: true, sz: 21 }) : '', rep.headline ? para(rep.headline, { sz: 24, after: 160 }) : '', table, rep.notes ? para('Notes', { b: true, sz: 22, after: 60 }) : '', ...String(rep.notes || '').split('\n').filter((l) => l.trim()).map((l) => para(l, { sz: 20 })), para(rep.footer || '', { color: '8089A0', sz: 16 })].join('');
    return zip([
      { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>` },
      { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>` },
      { name: 'word/document.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/><w:pgMar w:top="900" w:right="720" w:bottom="900" w:left="720" w:header="400" w:footer="400" w:gutter="0"/></w:sectPr></w:body></w:document>` },
    ]);
  }

  // ---- PDF (A4 landscape, Helvetica, text only) ----
  const L1 = (s) => String(s ?? '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/·/g, '-').replace(/[^\x20-\x7e¡-ÿ]/g, '?');
  const pdfEsc = (s) => L1(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  function pdf(rep) {
    const W = 842, H = 595, M = 36; const pages = []; let cur = null, y = 0;
    const HW = (t, size) => L1(t).length * size * 0.5; // average Helvetica width
    const newPage = () => { cur = []; pages.push(cur); y = H - M; };
    const text = (t, x, yy, size, bold, rgb) => cur.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${rgb || '0.13 0.16 0.27'} rg ${x} ${yy} Td (${pdfEsc(t)}) Tj ET`);
    const wrap = (t, size, width) => { const out = []; for (const para of String(t || '').split('\n')) { let line = ''; for (const word of para.split(/\s+/)) { const tryl = line ? line + ' ' + word : word; if (HW(tryl, size) > width && line) { out.push(line); line = word; } else line = tryl; } out.push(line); } return out; };
    newPage(); text(rep.title, M, y - 16, 18, true, '0.21 0.25 0.38'); y -= 30; text(rep.subtitle || '', M, y, 9, false, '0.35 0.39 0.47'); y -= 16;
    if ((rep.kpis || []).length) { text((rep.kpis || []).map((k) => `${k.label}: ${k.value}`).join('   |   '), M, y, 10, true); y -= 16; }
    if (rep.headline) for (const l of wrap(rep.headline, 11, W - 2 * M)) { text(l, M, y, 11, false); y -= 14; }
    y -= 6;
    const cols = rep.columns, size = cols.length > 10 ? 6.5 : cols.length > 7 ? 7.5 : 8.5;
    const want = cols.map((c) => Math.max(HW(c.label, size) + 6, ...rep.rows.slice(0, 120).map((r) => HW(show(r[c.k], c), size) + 6), 20));
    const total = want.reduce((a, b) => a + b, 0), avail = W - 2 * M; const ws = want.map((x) => Math.max(26, (x / total) * avail)); const sc = avail / ws.reduce((a, b) => a + b, 0); const widths = ws.map((x) => x * sc);
    const fit = (t, width) => { let s = L1(t); const max = Math.max(1, Math.floor((width - 4) / (size * 0.5))); return s.length > max ? s.slice(0, Math.max(1, max - 1)) + '.' : s; };
    const header = () => { cur.push(`0.21 0.25 0.38 rg ${M} ${y - 3} ${avail} ${size + 7} re f`); let x = M; cols.forEach((c, i) => { text(fit(c.label, widths[i]), x + 2, y, size, true, '1 1 1'); x += widths[i]; }); y -= size + 9; };
    header();
    rep.rows.forEach((r, ri) => {
      if (y < M + 20) { newPage(); header(); }
      if (ri % 2) cur.push(`0.93 0.94 0.96 rg ${M} ${y - 3} ${avail} ${size + 5} re f`);
      let x = M; cols.forEach((c, i) => { const t = fit(show(r[c.k], c), widths[i]); const right = c.type === 'num' || c.type === 'pct'; text(t, right ? x + widths[i] - HW(t, size) - 3 : x + 2, y, size, false); x += widths[i]; }); y -= size + 6;
    });
    if (rep.notes) { y -= 8; if (y < M + 40) { newPage(); } text('Notes', M, y, 10, true); y -= 14; for (const l of wrap(rep.notes, 9, W - 2 * M)) { if (y < M + 14) newPage(); text(l, M, y, 9, false); y -= 12; } }
    pages.forEach((p, i) => p.push(`BT /F1 7 Tf 0.5 0.54 0.63 rg ${M} 18 Td (${pdfEsc((rep.footer || '') + '   Page ' + (i + 1) + ' of ' + pages.length)}) Tj ET`));
    const objs = []; const add = (s) => { objs.push(s); return objs.length; };
    const catalog = add(''), pagesObj = add(''); const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'), f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const kids = pages.map((p) => { const content = p.join('\n'); const c = add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`); return add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${c} 0 R >>`); });
    objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`; objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => k + ' 0 R').join(' ')}] /Count ${kids.length} >>`;
    let out = '%PDF-1.4\n'; const offs = []; objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xref = out.length; out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('') + `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF`;
    const bytes = new Uint8Array(out.length); for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 255; return bytes;
  }

  const safe = (t) => String(t || 'report').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_').slice(0, 60) || 'report';
  const FORMATS = { csv: ['CSV (data)', 'csv', 'text/csv;charset=utf-8'], xlsx: ['Excel', 'xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'], docx: ['Word', 'docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'], pdf: ['PDF', 'pdf', 'application/pdf'] };
  // returns [{name, data, mime}] for the chosen formats; one file, or a zip when several
  function make(rep, formats) {
    const base = safe(rep.title); const files = [];
    for (const f of formats) { const fn = { csv, xlsx, docx, pdf }[f]; if (!fn) continue; files.push({ name: `${base}.${FORMATS[f][1]}`, data: fn(rep), mime: FORMATS[f][2] }); }
    if (files.length > 1) return [{ name: `${base}.zip`, data: zip(files.map((f) => ({ name: f.name, data: f.data }))), mime: 'application/zip' }];
    return files;
  }
  root.KFExport = { zip, csv, xlsx, docx, pdf, make, FORMATS };
})(typeof window !== 'undefined' ? window : globalThis);
