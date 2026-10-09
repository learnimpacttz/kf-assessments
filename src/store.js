// Strongly consistent storage for the running aggregates, the field plans and
// sync locks. Workers KV is eventually consistent (a read a minute later can
// return an old copy), which corrupts a running total. One Durable Object
// serialises every read and write instead.
import { DurableObject } from 'cloudflare:workers';

const CHUNK = 400000; // characters per stored piece, well under the per-value limit

export class Store extends DurableObject {
  async get(key) {
    const n = await this.ctx.storage.get(`k:${key}:n`);
    if (!n) return null;
    const keys = Array.from({ length: n }, (_, i) => `k:${key}:${i}`);
    const got = await this.ctx.storage.get(keys);
    return keys.map((k) => got.get(k)).join('');
  }
  async put(key, str) {
    const prev = (await this.ctx.storage.get(`k:${key}:n`)) || 0;
    const pieces = [];
    for (let i = 0; i < str.length; i += CHUNK) pieces.push(str.slice(i, i + CHUNK));
    if (!pieces.length) pieces.push('');
    const obj = { [`k:${key}:n`]: pieces.length };
    pieces.forEach((p, i) => (obj[`k:${key}:${i}`] = p));
    // storage.put accepts up to 128 keys; the data here stays far below that
    await this.ctx.storage.put(obj);
    if (prev > pieces.length) await this.ctx.storage.delete(Array.from({ length: prev - pieces.length }, (_, i) => `k:${key}:${pieces.length + i}`));
  }
  async del(key) {
    const n = (await this.ctx.storage.get(`k:${key}:n`)) || 0;
    await this.ctx.storage.delete([`k:${key}:n`, ...Array.from({ length: n }, (_, i) => `k:${key}:${i}`)]);
  }
  async acquire(name, ttlMs) {
    const now = Date.now();
    const until = await this.ctx.storage.get(`lock:${name}`);
    if (until && until > now) return false;
    await this.ctx.storage.put(`lock:${name}`, now + ttlMs);
    return true;
  }
  async release(name) {
    await this.ctx.storage.delete(`lock:${name}`);
  }
}

export const kv = (env) => {
  const stub = env.STORE.get(env.STORE.idFromName('hub'));
  return {
    get: async (key) => {
      const s = await stub.get(key);
      return s == null ? null : JSON.parse(s);
    },
    put: (key, val) => stub.put(key, JSON.stringify(val)),
    delete: (key) => stub.del(key),
    acquire: (name, ttl) => stub.acquire(name, ttl),
    release: (name) => stub.release(name),
  };
};
