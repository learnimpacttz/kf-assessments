// Lead Coordinators (LC): the RC of one region who also sees every region of their partner organization, read only
import { env, ok, done } from './_kit.mjs';
import { whoOfStaff, regionsOf, canSeeRegion, pickRegion } from '../src/auth.js';
import { STAFF, PARTNERS, REGIONS, leadOrgOf, leadsState, setLeads } from '../src/config.js';
import { leadsView, changeLeads } from '../src/roster.js';

const DEFAULT = { ...leadsState.map };
const rcOf = (region) => STAFF.find((s) => s.active && s.region === region && s.role === 'rc');
const lcs = Object.entries(DEFAULT).map(([org, id]) => ({ org, st: STAFF.find((s) => s.id === id) }));
ok('three organizations have a Lead Coordinator, each the RC of a region of that organization', lcs.length === 3 && lcs.every(({ org, st }) => st && st.role === 'rc' && PARTNERS[org].includes(st.region)), lcs.map((l) => l.org + ':' + (l.st && l.st.region)).join());
const gep = whoOfStaff(rcOf('TANGA'));
ok('the GEP lead is still the RC of Tanga, with the title and the organization\'s regions', gep.role === 'rc' && gep.region === 'TANGA' && gep.position === 'RC' && gep.lead === 'GEP' && gep.title === 'Lead Coordinator (LC)' && gep.regions.join() === PARTNERS.GEP.join());
ok('every other RC, every ARC and every volunteer has no lead role', STAFF.filter((s) => s.active && !Object.values(DEFAULT).includes(s.id)).every((s) => !whoOfStaff(s).lead && !whoOfStaff(s).regions));
ok('a lead sees the regions of their organization and no others', canSeeRegion(gep, 'MANYARA') && canSeeRegion(gep, 'LINDI') && canSeeRegion(gep, 'MTWARA') && !canSeeRegion(gep, 'MARA') && !canSeeRegion(gep, 'KIGOMA') && regionsOf(gep).length === 4);
const rc = whoOfStaff(rcOf('MANYARA')), vol = whoOfStaff(STAFF.find((s) => s.role === 'volunteer' && s.region === 'TANGA')), hq = { role: 'hq' };
ok('an ordinary RC and a volunteer still see only their own region; HQ sees all', regionsOf(rc).join() === 'MANYARA' && !canSeeRegion(rc, 'TANGA') && regionsOf(vol).join() === 'TANGA' && regionsOf(hq).length === REGIONS.length && canSeeRegion(hq, 'MARA'));
ok('asking for another region: allowed inside the organization, otherwise the person\'s own region', pickRegion(gep, 'lindi') === 'LINDI' && pickRegion(gep, 'MARA') === 'TANGA' && pickRegion(gep, '') === 'TANGA' && pickRegion(rc, 'TANGA') === 'MANYARA' && pickRegion(vol, 'MARA') === 'TANGA' && pickRegion(hq, 'mara') === 'MARA' && pickRegion(hq, '') === null);
ok('a preview of a lead (HQ viewing as them) carries the same role', whoOfStaff(rcOf('TANGA'), { viewAs: true }).lead === 'GEP' && whoOfStaff(rcOf('TANGA'), { viewAs: true }).viewAs === true);
ok('the role only applies to an active RC of a region in the organization', (() => { const st = { ...rcOf('TANGA') }; return leadOrgOf({ ...st, active: false }) === null && leadOrgOf({ ...st, role: 'arc' }) === null && leadOrgOf({ ...st, region: 'MARA' }) === null && leadOrgOf(st) === 'GEP'; })());
// HQ changes it
const view = await leadsView(env);
ok('HQ sees each organization, its regions, its lead and the RCs who could be the lead', view.orgs.length === 3 && view.orgs.every((o) => o.lead && o.options.length === PARTNERS[o.org].length));
ok('HQ can move the role to another RC of the same organization', (await changeLeads(env, { org: 'GEP', staff_id: rcOf('MANYARA').id })).ok && leadOrgOf(rcOf('MANYARA')) === 'GEP' && leadOrgOf(rcOf('TANGA')) === null);
ok('it cannot go to an RC of another organization, to a volunteer, or to nobody by mistake', (await changeLeads(env, { org: 'GEP', staff_id: rcOf('MARA').id })).error && (await changeLeads(env, { org: 'GEP', staff_id: STAFF.find((s) => s.role === 'volunteer').id })).error && (await changeLeads(env, { org: 'NOPE', staff_id: 1 })).error);
ok('HQ can clear it and put it back', (await changeLeads(env, { org: 'GEP', staff_id: null })).ok && leadOrgOf(rcOf('MANYARA')) === null && (await changeLeads(env, { org: 'GEP', staff_id: rcOf('TANGA').id })).ok && leadOrgOf(rcOf('TANGA')) === 'GEP');
setLeads(DEFAULT);
ok('the defaults are back for the other tests', JSON.stringify(leadsState.map) === JSON.stringify(DEFAULT));
done();
