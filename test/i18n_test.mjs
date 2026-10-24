// The Kiswahili layer: key phrases and number sentences must translate, user text must not be touched
import fs from 'node:fs'; import vm from 'node:vm';
import { ok, done } from './_kit.mjs';
const win = { document: { createTreeWalker() {}, documentElement: {}, body: {} } }; win.window = win; vm.createContext(win);
vm.runInContext(fs.readFileSync('../public/i18n-sw.js', 'utf8'), win);
const t = (s) => win.swTranslate(s);
ok('navigation', t('My queries') === 'Hoja zangu' && t('Pilot day') === 'Siku ya majaribio' && t('My work') === 'Kazi yangu');
ok('queries prompt with a count', t(' 1 to answer · 2 waiting for your review.').includes('1 ya kujibu') && t('3 to answer').startsWith('3 za kujibu'));
ok('slow tests sentence', t('5 tests over 14 min in Grade 2') === 'Vipimo 5 vilivyozidi dakika 14 katika Darasa la 2');
ok('duplicate pupil sentence with names', t('1 pupil number(s) tested twice in Grade 2 (the same pupil number was also tested by Adam and Ashura)') === 'Namba 1 za wanafunzi zimepimwa mara mbili katika Darasa la 2 (namba hiyohiyo ilipimwa pia na Adam na Ashura)');
ok('dates use Kiswahili days and months', t('Thu 15 Oct') === 'Alh 15 Okt' && t('Sat 17 Oct') === 'Jmosi 17 Okt');
ok('the flag label after a dot', t('· Test too slow') === '· Kipimo kwa polepole mno');
ok('help text', t('Still stuck?') === 'Bado umekwama?');
ok('names and unknown text are left alone', t('Ashura Waziri') === 'Ashura Waziri' && t('Hello team') === 'Hello team');
ok('leading and trailing spaces are kept', t(' Fix it: ') === ' Rekebisha: ');
ok('the standing card translates: tags, ranks and the reasons the system writes', t('Needs a hand') === 'Unahitaji msaada' && t('2 of 8') === '2 kati ya 8' && t('Sends records the same day (100%)') === 'Unatuma rekodi siku hiyohiyo (100%)' && t('High test quality (93)') === 'Ubora wa juu wa upimaji (93)', t('2 of 8'));
ok('the waiting-on-you sentences translate with their numbers', t('1 query waiting for a response beyond 2 working days (oldest 6)') === 'Hoja 1 zinasubiri jibu kwa zaidi ya siku 2 za kazi (ya zamani zaidi: siku 6)' && t('2 responses sent back for rework') === 'Majibu 2 yamerudishwa yarekebishwe' && t('36 open data checks on 131 tests') === 'Ukaguzi 36 wa data uko wazi kwenye vipimo 131');
ok('the team sentence translates', t('3 of 4 team members have a query waiting for a response. Your RC and ARC will help.').startsWith('3 kati ya wanatimu 4'));
done();
