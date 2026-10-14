// A QR code as a PNG, made inside the Worker (no outside service). Used for the sign-in link in emails and in Help.
import qrcode from 'qrcode-generator';

const crcTable = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const u32 = (n) => new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
const chunk = (type, data) => { const t = new TextEncoder().encode(type); const body = new Uint8Array(t.length + data.length); body.set(t); body.set(data, t.length); const out = new Uint8Array(12 + data.length); out.set(u32(data.length)); out.set(body, 4); out.set(u32(crc32(body)), 8 + data.length); return out; };

export async function qrPng(text, scale = 8, quiet = 4) {
  const qr = qrcode(0, 'M'); qr.addData(String(text)); qr.make(); const n = qr.getModuleCount(); const size = (n + quiet * 2) * scale;
  const raw = new Uint8Array((size + 1) * size); // one filter byte (0) per row, then 8-bit grey pixels
  for (let y = 0; y < size; y++) { const row = y * (size + 1); const my = Math.floor(y / scale) - quiet; for (let x = 0; x < size; x++) { const mx = Math.floor(x / scale) - quiet; raw[row + 1 + x] = my >= 0 && mx >= 0 && my < n && mx < n && qr.isDark(my, mx) ? 0 : 255; } }
  const z = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
  const ihdr = new Uint8Array(13); ihdr.set(u32(size), 0); ihdr.set(u32(size), 4); ihdr[8] = 8; ihdr[9] = 0; // 8-bit greyscale
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', z), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out;
}
