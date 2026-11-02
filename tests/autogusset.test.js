// Auto's gussets and hoops (web/fins/gussets.js, the "Auto can use" boxes): off by
// default, so Auto is unchanged; ticked, they take the red the walls left bare and
// the walls much taller than they are. Pinned on the three parts the drawn ones were
// built against, printed upright (Y up in the files): boss_tube (Body3: a round boss
// half way up a tube, held by a 69 mm wall from the plate), hoop_tab (a tab with a
// hole, nothing under it: Auto leaves it bare) and eyelet_rim (Body22: lips round
// the inside of a tube, eyelets on them, 82 mm walls under the top lip).

import { loadModel, analyze, fins, assert } from './_util.js';

const UP = [1, 0, 0, 0, 0, 1, 0, -1, 0];
const parts = new Map();
const part = (name) => {
  if (!parts.has(name)) { const topo = loadModel(name); parts.set(name, { topo, res: analyze(topo, 45, UP) }); }
  return parts.get(name);
};
const build = (name, extra = {}) => {
  const { topo, res } = part(name);
  return fins.buildFins(topo, res, UP, { mode: 'auto', bedPad: true, tines: true, coverage: 0.5, ...extra });
};
const count = (b, kind, hoop) => b.fins.filter((f) => f.kind === kind && (hoop === undefined || !!f.hoop === hoop)).length;
const tallest = (b) => Math.max(0, ...b.fins.filter((f) => f.kind === 'prop').map((f) => f.height ?? 0));

/** Every fin's ranges, together, cover the triangles once each. */
function rangesTile(b) {
  const rs = b.fins.flatMap((f) => f.triRanges ?? []).sort((x, y) => x[0] - y[0]);
  let at = 0;
  for (const [a, e] of rs) {
    if (a !== at) return `a gap or overlap at ${at}..${a}`;
    at = e;
  }
  return at === b.triangles.length ? null : `ranges end at ${at} of ${b.triangles.length}`;
}

Deno.test('auto gussets: off by default — the boxes unticked build exactly what Auto did', () => {
  for (const name of ['boss_tube', 'hoop_tab']) {
    const plain = build(name), off = build(name, { autoGussets: false, autoHoops: false, straightWalls: true });
    assert(plain.triangles.length === off.triangles.length, `${name}: ${plain.triangles.length} vs ${off.triangles.length} triangles`);
    assert(count(plain, 'gusset') === 0 && !plain.autoGussets, `${name}: gussets with the boxes off`);
  }
});

Deno.test('auto gussets: the round boss half way up the tube — gussets instead of its 69 mm wall', () => {
  const plain = build('boss_tube'), g = build('boss_tube', { autoGussets: true });
  assert(tallest(plain) > 60, `the plain build’s tallest wall is ${tallest(plain).toFixed(1)} mm`);
  assert(tallest(g) < 10, `a ${tallest(g).toFixed(1)} mm wall stayed`);
  assert(count(g, 'gusset') >= 1 && g.autoGussets.swapped === 1, `${count(g, 'gusset')} gussets, ${g.autoGussets.swapped} walls swapped`);
  for (const f of g.fins.filter((x) => x.kind === 'gusset')) {
    assert(f.auto && f.height * 3 <= 69.3, `a gusset ${f.height.toFixed(1)} mm tall`);
    assert(Math.min(...f.line.map((p) => p[2])) > 55, 'a gusset off the boss');
  }
  // they hold more of the boss than the wall did, not less
  assert(g.bare.area < plain.bare.area, `bare ${g.bare.area.toFixed(1)} mm², was ${plain.bare.area.toFixed(1)}`);
  const why = rangesTile(g);
  assert(!why, why);
});

Deno.test('auto gussets: a tab no wall reaches gets a gusset, or with Hoops ticked a hoop round its hole', () => {
  const plain = build('hoop_tab');
  assert(plain.bare.area > 15, `the plain build leaves ${plain.bare.area.toFixed(1)} mm² bare`);
  const g = build('hoop_tab', { autoGussets: true });
  assert(count(g, 'gusset', false) === 1 && g.bare.area < 1, `${count(g, 'gusset', false)} gussets, ${g.bare.area.toFixed(1)} mm² bare`);
  const h = build('hoop_tab', { autoGussets: true, autoHoops: true });
  assert(count(h, 'gusset', true) === 1 && count(h, 'gusset', false) === 0, 'not one hoop round the hole');
  assert(h.bare.area < 1, `${h.bare.area.toFixed(1)} mm² bare`);
  // a hoop alone, without gussets, still goes round it
  const only = build('hoop_tab', { autoHoops: true });
  assert(count(only, 'gusset', true) === 1, 'Hoops alone built no hoop');
});

Deno.test('auto gussets: Straight walls unticked — only the gussets hold the boss', () => {
  const g = build('boss_tube', { autoGussets: true, straightWalls: false });
  assert(count(g, 'prop') === 0 && count(g, 'wedge') === 0, `${count(g, 'prop')} walls, ${count(g, 'wedge')} wedges`);
  assert(count(g, 'gusset') >= 2, `${count(g, 'gusset')} gussets`);
  const why = rangesTile(g);
  assert(!why, why);
});

Deno.test('auto gussets: the eyelet tube — tall walls under the top lip go, the lips and eyelets held', () => {
  const plain = build('eyelet_rim');
  const g = build('eyelet_rim', { autoGussets: true, autoHoops: true });
  assert(g.autoGussets.swapped >= 3, `${g.autoGussets.swapped} walls swapped`);
  assert(count(g, 'gusset', true) >= 1, 'no hoop round an eyelet');
  assert(g.bare.area < plain.bare.area / 10, `bare ${g.bare.area.toFixed(1)} mm², was ${plain.bare.area.toFixed(1)}`);
  const why = rangesTile(g);
  assert(!why, why);
});
