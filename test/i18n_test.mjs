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
ok('the All teams page translates: tab, headings and speeds', t('All teams') === 'Timu zote' && t('Fastest to reply') === 'Wanaojibu kwa haraka zaidi' && t('same day') === 'siku hiyohiyo' && t('2 days') === 'siku 2' && t('3 open · 1 overdue') === '3 zilizo wazi · 1 zilizochelewa' && t('7 replied') === '7 wamejibu');

// ---- sent after the test day: the wording and the question are translated, and the dates keep their order
const late = t('3 of 12 test records at KIPERESA Grade 2 were sent on Tue 20 Oct, not on the test day Mon 19 Oct. Testing finished at 14:20 on the phone and the last record was sent at 07:58, 17 hours 38 min later. The first test that day, at LOLTEPESI, started at 08:09 on the phone, 11 minutes after the records were sent.');
ok('the late-sending sentence translates, with the count of records', late.startsWith('Rekodi 3 kati ya 12 za vipimo katika KIPERESA Darasa la 2') && late.includes('si siku ya mtihani') && late.includes('17 saa 38 dakika baadaye') && late.includes('11 dakika baada ya rekodi kutumwa'), late);
ok('the question to the team translates', t('Please explain: why were they not sent on Mon 19 Oct, before leaving the school, and where were they sent from on Tue 20 Oct? Poor signal is a real problem, so say what was tried (moving to a place with signal, a hotspot) and what will be done so it does not repeat. Records should be sent the same day; turn on auto send in KoBo Collect so nothing waits on the phone.').startsWith('Tafadhali eleza: kwa nini hazikutumwa'));
ok('the timing labels translate', t('When things happened') === 'Mambo yalivyotokea kwa wakati' && t('Sent after the test day') === 'Ilitumwa baada ya siku ya mtihani');
done();
