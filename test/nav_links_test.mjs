// Buttons that carry an action (data-act) must run it. A plain tab shortcut ran first and swallowed the Bridge links (filters, "Open the list").
import fs from 'node:fs';
import { ok, done } from './_kit.mjs';
const app = fs.readFileSync('../public/app.js', 'utf8');
const br = fs.readFileSync('../src/bridge.js', 'utf8');
ok('the tab shortcut skips buttons that have an action', app.includes("if (t.dataset.tab && !t.dataset.act)"));
ok('Bridge links can name a card to open and scroll to', app.includes("t.dataset.card && S.tab === tab") && app.includes('data-card="${esc(x.act.card)}"'));
ok('both Bridge "needs" lists pass the card and filter through', (app.match(/x\.act\.card \? `data-card=/g) || []).length === 2);
ok('operations alerts point at the operations card', (br.match(/card: 'ops', label: 'Open the list'/g) || []).length === 2 && app.includes('id="bv-${id}"'));
ok('Advisors do not request the HQ notes or question counts', app.includes("!notGiven('notes')") && app.includes("!notGiven('questions')") && app.includes("if (notGiven('notes')) return;"));
const css = fs.readFileSync('../public/style.css', 'utf8');
ok('the page "i" text can open on a phone (the phone rule must not outrank it)', css.includes('#app .pagehead p.intro.open{display:block}'));
ok('the region-by-week grid has its own class, apart from the Usage Explorer hour map', app.includes('class="heatw"') && css.includes('.heatw{display:grid') && !/class="heat" style="grid-template-columns/.test(app));
ok('the map separates Treatment, Control and Pilot by shape and can filter by group', app.includes("arm === 'Control' ? 'rect'") && app.includes('id="mpArm"'));
done();
