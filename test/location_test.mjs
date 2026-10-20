// Location check: distances, the different ways a phone's point can be stored, and that no coordinates leave the summary
import { ok, done } from './_kit.mjs';
import { metres, pointOf, summarizeLocation } from '../src/location.js';
import { SCHOOL_COORDS } from '../src/data/school_coords.js';
const id = Object.keys(SCHOOL_COORDS)[0]; const [la, lo] = SCHOOL_COORDS[id];
ok('one degree of latitude is about 111 km', Math.abs(metres([0, 0], [1, 0]) - 111195) < 300);
ok('same point is 0 m', metres([la, lo], [la, lo]) === 0);
ok('a point 0.001 degrees away is about 111 m', Math.abs(metres([la, lo], [la + 0.001, lo]) - 111) < 2);
ok('reads _geolocation', pointOf({ _geolocation: [la, lo] })?.src === '_geolocation');
ok('reads a geopoint string with altitude and accuracy', pointOf({ 'id_data/start-geopoint': `${la} ${lo} 1200 5` })?.src === 'start-geopoint');
ok('reads latitude and longitude fields', pointOf({ latitude: String(la), longitude: String(lo) })?.src === 'latitude/longitude');
ok('ignores empty or zero points', pointOf({ _geolocation: [null, null] }) === null && pointOf({ _geolocation: [0, 0] }) === null && pointOf({}) === null);
const recs = [
  { _geolocation: [la + 0.001, lo], 'id_data/school': id, distance: '110' },
  { _geolocation: [la + 0.01, lo], 'id_data/school': id },
  { _geolocation: [la + 0.0005, lo], 'id_data/school': id },
  { _geolocation: [null, null], 'id_data/school': id }];
const s = summarizeLocation(recs);
ok('counts records, points and the form distance', s.sampled === 4 && s.with_point === 3 && s.with_form_distance === 1);
ok('share within 500 m is 2 of 3', s.measured === 3 && s.within_500 === 2);
ok('no coordinates in the summary', !JSON.stringify(s).includes(String(la).slice(0, 7)));
ok('school coordinates cover most of the 325 schools', Object.keys(SCHOOL_COORDS).length >= 300);
done();
