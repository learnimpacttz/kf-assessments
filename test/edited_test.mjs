import { editedAfterSent } from '../src/ingest.js';
const t = (name, r, want) => { const got = editedAfterSent(r); console.log(got === want ? 'PASS' : 'FAIL', name); if (got !== want) process.exitCode = 1; };
t('normal record', { start: '2026-10-15T09:00:00+03:00', end: '2026-10-15T09:10:00+03:00', _submission_time: '2026-10-15T06:30:00' }, false);
t('long form window but sent after end: not an edit', { start: '2024-10-09T09:47:26+03:00', end: '2024-10-09T11:46:33+03:00', _submission_time: '2024-10-09T10:10:41' }, false);
t('end a month after it was sent (real sampling example)', { start: '2025-10-21T08:30:23+03:00', end: '2025-11-19T08:45:59+03:00', _submission_time: '2025-10-21T12:20:30' }, true);
t('web edit leaves the old copy id', { start: '2026-10-15T09:00:00+03:00', end: '2026-10-15T09:10:00+03:00', _submission_time: '2026-10-15T06:30:00', 'meta/deprecatedID': 'uuid:abc' }, true);
t('no times at all', {}, false);
