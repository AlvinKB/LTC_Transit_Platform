const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'Forest City Transit.html'), 'utf8');
const context = { window: {} }; vm.createContext(context);
vm.runInContext(html.match(/<script id="trip-planner-engine">([\s\S]*?)<\/script>/)[1], context);
const api = context.window.FCTPlanner;
const real = JSON.parse(html.match(/<script type="application\/json" id="d-planner">([\s\S]*?)<\/script>/)[1]);
const stop = (name, lon) => [name, name, 42.987, lon];
const place = s => ({ lat: s[2], lon: s[3] });
const trip = (stops, times, route = 0, pickup = stops.map(() => 0), dropoff = stops.map(() => 0)) =>
  [route, 0, 'Test trip', stops, times, times, pickup, dropoff, 'test'];
const A = stop('A', -81.30), B = stop('B', -81.26), C = stop('C', -81.22);
const fixture = trips => ({ stops: [A, B, C], routes: [['1', 'Test', '123456'], ['2', 'Test 2', '654321']], trips });

test('direct trip follows stop order and exact timetable; reverse is unavailable', () => {
  const planner = api.create(fixture([trip([0, 1, 2], [1000, 1200, 1400])]));
  const result = planner.plan(place(A), place(C), 900);
  assert.equal(result.journeys[0].arrival, 1400);
  assert.equal(result.journeys[0].boardings, 1);
  assert.equal(result.journeys[0].legs.find(l => l.kind === 'ride').start, 1000);
  assert.equal(planner.plan(place(C), place(A), 900).journeys.length, 0);
});
test('missed buses are rejected instead of using an earlier departure', () => {
  const planner = api.create(fixture([trip([0, 2], [1000, 1400])]));
  assert.equal(planner.plan(place(A), place(C), 1001).journeys.length, 0);
});
test('a transfer needs two minutes; an impossible short connection is rejected', () => {
  const valid = api.create(fixture([trip([0, 1], [1000, 1200]), trip([1, 2], [1320, 1500], 1)]));
  assert.equal(valid.plan(place(A), place(C), 900).journeys[0].boardings, 2);
  const invalid = api.create(fixture([trip([0, 1], [1000, 1200]), trip([1, 2], [1319, 1500], 1)]));
  assert.equal(invalid.plan(place(A), place(C), 900).journeys.length, 0);
});
test('pickup and drop-off restrictions are respected', () => {
  const noPickup = api.create(fixture([trip([0, 2], [1000, 1400], 0, [1, 0])]));
  const noDropoff = api.create(fixture([trip([0, 2], [1000, 1400], 0, [0, 0], [0, 1])]));
  assert.equal(noPickup.plan(place(A), place(C), 900).journeys.length, 0);
  assert.equal(noDropoff.plan(place(A), place(C), 900).journeys.length, 0);
});
test('after-midnight GTFS times remain on the same service day', () => {
  const planner = api.create(fixture([trip([0, 2], [87000, 87600])]));
  assert.equal(planner.plan(place(A), place(C), 86500).journeys[0].arrival, 87600);
});
test('two transfers are supported and a fourth boarding exceeds the limit', () => {
  const D = stop('D', -81.18), E = stop('E', -81.14);
  const data = fixture([trip([0, 1], [1000, 1200]), trip([1, 2], [1400, 1600], 1), trip([2, 3], [1800, 2000]), trip([3, 4], [2200, 2400], 1)]);
  data.stops.push(D, E);
  const planner = api.create(data);
  assert.equal(planner.plan(place(A), place(D), 900).journeys[0].boardings, 3);
  assert.equal(planner.plan(place(A), place(E), 900).journeys.length, 0);
});
test('alternatives with worse arrival, transfers, and walking are omitted', () => {
  const D = stop('D', -81.215);
  const data = fixture([trip([0, 2], [1000, 1400]), trip([0, 1], [1000, 1200], 1), trip([1, 3], [1400, 1600], 1)]);
  data.stops.push(D);
  const result = api.create(data).plan(place(A), place(C), 900);
  assert.equal(result.journeys.length, 1);
  assert.equal(result.journeys[0].arrival, 1400);
});
test('locations away from service return a useful empty result', () => {
  const planner = api.create(fixture([trip([0, 2], [1000, 1400])]));
  const result = planner.plan({lat: 43.08, lon: -81.4}, place(C), 900);
  assert.equal(result.journeys.length, 0); assert.match(result.reason, /800 m/);
});
test('walking between nearby transfer stops includes walk time and connection buffer', () => {
  const D = stop('D', -81.259);
  const data = fixture([trip([0, 1], [1000, 1200]), trip([3, 2], [1450, 1800], 1)]);
  data.stops.push(D);
  const result = api.create(data).plan(place(A), place(C), 900);
  assert.equal(result.journeys[0].boardings, 2);
  assert.ok(result.journeys[0].legs.some(l => l.kind === 'walk' && l.from === 1 && l.to === 3));
});
test('embedded LTC timetable is structurally valid and provides real direct/transfer trips', () => {
  assert.equal(real.date, '2026-10-20'); assert.equal(real.routes.length, 38);
  assert.equal(real.stops.length, 1953); assert.ok(real.trips.length > 3000);
  for (const t of real.trips) {
    assert.ok(real.routes[t[0]]); assert.equal(t[3].length, t[4].length);
    assert.equal(t[3].length, t[5].length);
    t[3].forEach((s, i) => { assert.ok(real.stops[s]); assert.ok(t[4][i] <= t[5][i]); if (i) assert.ok(t[5][i - 1] <= t[4][i]); });
  }
  const planner = api.create(real);
  const richmond = real.stops.find(s => /Richmond at Queens NB/i.test(s[1]));
  const masonville = real.stops.find(s => /Masonville Place Stop #1/i.test(s[1])) || real.stops.find(s => /Masonville Place/i.test(s[1]));
  const fanshawe = real.stops.find(s => /Fanshawe College Stop/i.test(s[1]));
  assert.ok(richmond && masonville && fanshawe);
  for (const [from, to] of [[richmond, masonville], [masonville, fanshawe]]) {
    const result = planner.plan(place(from), place(to), 15 * 3600 + 5 * 60);
    assert.ok(result.journeys.length, `${from[1]} to ${to[1]} must have a scheduled option`);
    for (const j of result.journeys) {
      assert.ok(j.boardings <= 3 && j.arrival >= j.departure);
      let previousEnd = j.departure;
      for (const leg of j.legs) {
        assert.ok(leg.start >= previousEnd); assert.ok(leg.end >= leg.start); previousEnd = leg.end;
        if (leg.kind === 'ride') {
          const t = real.trips[leg.trip]; assert.equal(leg.start, t[5][leg.fromIndex]);
          assert.equal(leg.end, t[4][leg.toIndex]); assert.equal(t[6][leg.fromIndex], 0); assert.equal(t[7][leg.toIndex], 0);
        }
      }
    }
  }
});
