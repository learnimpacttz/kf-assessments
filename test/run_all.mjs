// Runs every test, on Windows, Mac or Linux: `npm test`.
// Same job as run_all.sh: checks the main files for syntax errors, bundles each test/*_test.mjs (the Worker code needs a stub
// for the Cloudflare runtime) and runs it with Node.
import { readdirSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let failed = false;

for (const f of ['public/app.js', 'public/i18n-sw.js', 'src/index.js']) {
  const r = spawnSync(process.execPath, ['--check', join(root, f)], { encoding: 'utf8' });
  if (r.status !== 0) { console.log(`SYNTAX ERROR in ${f}\n${r.stderr}`); failed = true; }
}

const dist = join(root, 'test', 'dist'); mkdirSync(dist, { recursive: true });
const tests = readdirSync(join(root, 'test')).filter((f) => f.endsWith('_test.mjs')).sort();
for (const f of tests) {
  const name = basename(f, '.mjs'); const out = join(dist, name + '.mjs');
  try {
    await build({ entryPoints: [join(root, 'test', f)], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'silent', alias: { 'cloudflare:workers': join(root, 'test', 'cfw-stub.js') } });
  } catch (e) { console.log(`BUILD FAILED ${name}`); failed = true; continue; }
  const r = spawnSync(process.execPath, [out], { cwd: join(root, 'test'), encoding: 'utf8' });
  const text = (r.stdout || '') + (r.stderr || '');
  const pass = (text.match(/^(PASS|ALL PASS)/gm) || []).length, fail = (text.match(/^(FAIL|FAILED)/gm) || []).length;
  console.log(`== ${name}: ${pass} passed, ${fail} failed`);
  if (r.status !== 0) { console.log(text.split('\n').filter((l) => /^FAIL/.test(l)).join('\n')); failed = true; }
}
console.log(failed ? 'SOME TESTS FAILED' : 'ALL TESTS PASSED');
process.exit(failed ? 1 : 0);
