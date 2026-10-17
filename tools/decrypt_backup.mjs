#!/usr/bin/env node
// Opens an encrypted Command Center backup.   node tools/decrypt_backup.mjs backup.json.gz.enc [out.json]
// The passphrase is read from the BACKUP_PASSPHRASE environment variable (never typed on the command line).
import fs from 'node:fs'; import zlib from 'node:zlib'; import { webcrypto as crypto } from 'node:crypto';
const [file, out = file.replace(/\.json\.gz\.enc$/, '') + '.json'] = process.argv.slice(2);
if (!file || !process.env.BACKUP_PASSPHRASE) { console.error('Usage: BACKUP_PASSPHRASE=... node tools/decrypt_backup.mjs <file.json.gz.enc> [out.json]'); process.exit(1); }
const u = new Uint8Array(fs.readFileSync(file)); const magic = new TextEncoder().encode('KF4E1');
if (!magic.every((b, i) => u[i] === b)) { fs.writeFileSync(out, zlib.gunzipSync(u)); console.log('Not encrypted; unpacked to', out); process.exit(0); }
const salt = u.slice(5, 21), iv = u.slice(21, 33), ct = u.slice(33);
const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(process.env.BACKUP_PASSPHRASE), 'PBKDF2', false, ['deriveKey']);
const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
try { const gz = Buffer.from(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct)); fs.writeFileSync(out, zlib.gunzipSync(gz)); console.log('Decrypted to', out); } catch { console.error('Wrong passphrase or damaged file.'); process.exit(2); }
