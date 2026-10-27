// Light and dark themes: every color token exists in both, nothing falls back to a light color by accident, and the text colors that matter keep their contrast
import fs from 'node:fs';
import { ok, done } from './_kit.mjs';

const css = fs.readFileSync('../public/style.css', 'utf8'); const app = fs.readFileSync('../public/app.js', 'utf8');
const tokens = (block) => Object.fromEntries([...block.matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g)].map((m) => [m[1], m[2].trim()]));
const root = tokens(/:root\{([^}]*)\}/.exec(css)[1]);
const darkMedia = tokens(/@media\(prefers-color-scheme:dark\)\{:root:not\(\[data-theme="light"\]\)\{([^}]*)\}\}/.exec(css)[1]);
const darkAttr = tokens(/:root\[data-theme="dark"\]\{([^}]*)\}/.exec(css)[1]);

// ---- tokens
const used = new Set([...(css + app).matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]));
const undef = [...used].filter((v) => !(v in root));
ok('every color variable the page uses is defined (an undefined one falls back to a light color in dark mode)', undef.length === 0, undef.join(', '));
ok('the two dark blocks (system dark, and the dark switch) define exactly the same values', JSON.stringify(darkMedia) === JSON.stringify(darkAttr));
const sameInBoth = ['--f-display', '--f-body', '--f-mono', '--on-brand', '--gold']; // fonts and colors that read the same on both
const missing = Object.keys(root).filter((k) => !(k in darkMedia) && !sameInBoth.includes(k));
ok('every other token set for light is also set for dark', missing.length === 0, missing.join(', '));

// ---- no fixed light backgrounds on pieces that follow the theme
const fixedWhite = [...css.matchAll(/([^{}]+)\{[^{}]*background:(?:#fff|#FFF|white)[;}][^{}]*\}/g)].map((m) => m[1].trim().split('\n').pop()).filter((sel) => !/^(\.vsel option|#nav2 button\[aria-selected=true\]|\.plogo)/.test(sel));
ok('no panel, chip or box has a fixed white background (the assistant panel and the message chips had)', fixedWhite.length === 0, fixedWhite.join(' | '));
ok('text fields follow the theme but do not outrank the rules of particular fields (the header search box)', /:where\(input:not\(\[type=checkbox\]\)[^)]*\)[^{]*\{background:var\(--surface\);color:var\(--ink\)\}/.test(css) && /:where\(input,textarea\)::placeholder\{color:var\(--ph\)/.test(css));

// ---- contrast of the colors that carry text
const hex = (h) => { h = h.replace('#', ''); if (h.length === 3) h = [...h].map((c) => c + c).join(''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255); };
const lum = (h) => { const [r, g, b] = hex(h).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const cr = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const val = (T, k) => T[k] || root[k];
for (const [name, T] of [['light', root], ['dark', darkMedia]]) {
  for (let i = 1; i <= 5; i++) { const r = cr(val(T, `--hb${i}`), val(T, `--hf${i}`)); ok(`${name}: heat table step ${i} text reads (${r.toFixed(1)}:1)`, r >= 4.5); }
  const phOn = ['--surface', '--surface2'].map((s) => cr(val(T, '--ph'), val(T, s))); ok(`${name}: placeholder text reads on a field (${Math.min(...phOn).toFixed(1)}:1)`, Math.min(...phOn) >= 4.5);
  for (const k of ['--ink', '--ink2']) for (const s of ['--surface', '--surface2', '--bg']) { const r = cr(val(T, k), val(T, s)); ok(`${name}: ${k} on ${s} (${r.toFixed(1)}:1)`, r >= 4.5); }
}
// light: small gray text, status text on its tinted background, and the teal of bars
for (const s of ['--surface', '--surface2', '--bg', '--warn-bg', '--bad-bg', '--good-bg']) { const r = cr(root['--ink3'], val(root, s)); ok(`light: small gray text on ${s} (${r.toFixed(1)}:1)`, r >= 4.5); }
for (const [k, bgs] of [['--good-ink', ['--good-bg', '--surface', '--surface2']], ['--warn-ink', ['--warn-bg', '--surface', '--surface2']]]) for (const [name, T] of [['light', root], ['dark', darkMedia]]) for (const b of bgs) { const r = cr(val(T, k), val(T, b)); ok(`${name}: ${k} text on ${b} (${r.toFixed(1)}:1)`, r >= 4.5); }
for (const b of ['--surface', '--surface2']) { const r = cr(root['--teal'], root[b]); ok(`light: teal bars stand out from ${b} (${r.toFixed(1)}:1)`, r >= 3); }
for (const [name, T, bgs] of [['light', root, ['--surface', '--surface2']], ['dark', darkMedia, ['--surface', '--surface2']]]) for (let i = 1; i <= 8; i++) { const r = Math.min(...bgs.map((b) => cr(val(T, `--c${i}`), val(T, b)))); ok(`${name}: chart color ${i} stands out from its card (${r.toFixed(1)}:1)`, r >= 3); }
ok('the charts use the theme chart colors, not fixed pale ones', /SCHOOL_COLORS = \['var\(--c1\)'/.test(app) && !/'#7E8CD0'/.test(app) && /const gcol = \{ 1: 'var\(--c1\)', 2: 'var\(--c2\)', 3: 'var\(--c3\)' \}/.test(app));
ok('status colors that carry text use the readable variants, not the bar colors', !/(?<![-\w])color:var\(--(good|warn)\)/.test(css));
for (const s of ['--surface', '--surface2', '--warn-bg']) { const r = cr(darkMedia['--ink3'], darkMedia[s]); ok(`dark: small gray text on ${s} (${r.toFixed(1)}:1)`, r >= 4.5); }
for (const c of ['good', 'warn', 'bad', 'mute']) { const m = new RegExp(`\\.tile\\.${c}\\{background:(#[0-9a-fA-F]{6})\\}`).exec(css); const r = cr(m[1], '#ffffff'); ok(`white text on the ${c} tile (${r.toFixed(1)}:1)`, r >= 4.5); }
const chart = cr(darkMedia['--chart-navy'], darkMedia['--surface']); ok(`dark: the final-approval bar stands out from the card (${chart.toFixed(1)}:1)`, chart >= 3);

// ---- the heat table is by day, with a step and a text color for each
ok('the pupils-tested table is by region and day, not by week', /Pupils tested, by region and day/.test(app) && !/by region and week/.test(app));
ok('each step of the table has its own class with its own text color', ['h0', 'h1', 'h2', 'h3', 'h4', 'h5'].every((c) => new RegExp(`\\.heatw i\\.${c}\\{`).test(css)) && /class="h\$\{lvl\(v\)\}"/.test(app));
ok('on a phone the table scrolls sideways instead of squeezing the days', /\.heatscroll\{overflow-x:auto/.test(css) && /min-width:\$\{90 \+ days\.length \* 36\}px/.test(app));
done();
