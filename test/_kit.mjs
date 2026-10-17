// shared helpers for the tests: an in-memory store and a tiny pass/fail reporter
export const mem = new Map();
const stub = { get: async (k) => mem.get(k) ?? null, put: async (k, v) => void mem.set(k, v), del: async (k) => void mem.delete(k) };
export const env = { STORE: { idFromName: () => 'x', get: () => stub }, AUTH_SALT: 'test-salt', HQ_SECRET: 'HQTEST' };
let fail = 0; export const ok = (n, c, d = '') => { console.log((c ? 'PASS ' : 'FAIL ') + n + (d ? ' · ' + d : '')); if (!c) fail++; };
export const done = () => { console.log(fail ? `\n${fail} FAILED` : '\nall passed'); if (fail) process.exit(1); };
