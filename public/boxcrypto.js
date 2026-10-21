// Suggestion box: a message is locked on the sender's phone with a key that only the Executive Director holds. The server keeps only the locked text.
// RSA-OAEP (3072 bit) locks a fresh AES-GCM key for each message; the message itself is AES-GCM. Needs a secure page (https), which the app is.
(function () {
  const enc = new TextEncoder(), dec = new TextDecoder();
  const subtle = () => globalThis.crypto.subtle;
  const b64 = (buf) => { const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  async function fingerprint(spkiB64) { // a short code both sides can compare, so a swapped key is noticed
    const h = new Uint8Array(await subtle().digest('SHA-256', unb64(spkiB64)));
    return Array.from(h.slice(0, 8)).map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase().replace(/(.{4})/g, '$1 ').trim();
  }
  async function genKeys() {
    const kp = await subtle().generateKey({ name: 'RSA-OAEP', modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['encrypt', 'decrypt']);
    const spki = b64(await subtle().exportKey('spki', kp.publicKey)); const jwk = await subtle().exportKey('jwk', kp.privateKey);
    return { spki, jwk, fp: await fingerprint(spki) };
  }
  async function fingerprintOfJwk(jwk) { // the public half of a private key file
    const pub = await subtle().importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RSA-OAEP-256', ext: true }, { name: 'RSA-OAEP', hash: 'SHA-256' }, true, ['encrypt']);
    return fingerprint(b64(await subtle().exportKey('spki', pub)));
  }
  async function encrypt(spkiB64, obj) {
    const pub = await subtle().importKey('spki', unb64(spkiB64), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
    const aes = await subtle().generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']); const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    let text = JSON.stringify(obj); const pad = 512 - (enc.encode(text).length % 512); text += ' '.repeat(pad); // every message length falls in a 512-byte step, so length says little
    const ct = await subtle().encrypt({ name: 'AES-GCM', iv }, aes, enc.encode(text)); const wk = await subtle().encrypt({ name: 'RSA-OAEP' }, pub, await subtle().exportKey('raw', aes));
    return { iv: b64(iv), ct: b64(ct), wk: b64(wk) };
  }
  async function decrypt(jwk, item) {
    const priv = await subtle().importKey('jwk', jwk, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt']);
    const raw = await subtle().decrypt({ name: 'RSA-OAEP' }, priv, unb64(item.wk)); const aes = await subtle().importKey('raw', raw, { name: 'AES-GCM' }, false, ['decrypt']);
    return JSON.parse(dec.decode(await subtle().decrypt({ name: 'AES-GCM', iv: unb64(item.iv) }, aes, unb64(item.ct))));
  }
  const api = { genKeys, fingerprint, fingerprintOfJwk, encrypt, decrypt };
  if (typeof module === 'object' && module.exports) module.exports = api; else globalThis.BoxCrypto = api;
})();
