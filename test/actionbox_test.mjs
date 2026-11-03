// The action box: the colour rules (red = due today, late or waiting more than 2 working days; amber = due in the next 2 working days; plain = nothing due)
import fs from 'node:fs';
import { ok, done } from './_kit.mjs';
const app = fs.readFileSync('../public/app.js', 'utf8');
const pure = app.slice(app.indexOf('// act-pure-start'), app.indexOf('// act-pure-end'));
const { actWd, actToneDue, actToneAge, actSort } = new Function(pure + '; return { actWd, actToneDue, actToneAge, actSort };')();
const at = (iso) => new Date(iso); // 'now' as East Africa Time in UTC fields: the code adds no offset when given a date
ok('working days skip the weekend', actWd('2026-11-06', '2026-11-09') === 1 && actWd('2026-11-09', '2026-11-06') === -1 && actWd('2026-11-05', '2026-11-05') === 0);
const now = at('2026-11-04T10:00:00Z'); // Wednesday
ok('a date in the past is red and late', JSON.stringify(actToneDue('2026-11-03', now)) === '{"tone":"red","label":"Late"}');
ok('due today is red', JSON.stringify(actToneDue('2026-11-04', now)) === '{"tone":"red","label":"Due today"}');
ok('due tomorrow is amber', actToneDue('2026-11-05', now).tone === 'amber');
ok('due in two working days is amber', actToneDue('2026-11-06', now).tone === 'amber');
ok('due in three working days is plain', actToneDue('2026-11-09', now).tone === 'plain');
ok('a time that has passed is late (the 18:00 deadline)', actToneDue('2026-11-04T09:00', now).tone === 'red' && actToneDue('2026-11-04T18:00', now).label === 'Due today');
ok('over the weekend: due on Monday is amber on Friday', actToneDue('2026-11-09', at('2026-11-06T09:00:00Z')).tone === 'amber');
ok('no due date: red only after more than 2 working days', actToneAge('2026-11-02', now).tone === 'plain' && actToneAge('2026-10-30', now).tone === 'red' && actToneAge('2026-10-30', now).label === 'Waiting 3 days');
ok('red comes first, then amber, then plain', actSort([{ tone: 'plain' }, { tone: 'red' }, { tone: 'amber' }, { tone: 'red' }]).map((x) => x.tone).join() === 'red,red,amber,plain');
ok('the page uses one box instead of six bars', app.includes('langBanner + actionBox() +') && !/\+ dmBanner\(\) \+ planBanner/.test(app));
ok('queries are one line in the box, not a second bar', app.includes('Queries: ${[q.mine') && /function queryPrompt\(\) \{\s*return ''/.test(app));
ok('the box shows at most three items, the rest fold under "and N more"', app.includes('items.slice(0, 3)') && app.includes('and ${rest.length} more'));
done();
