// Gusset hoops (web/hoop.js): a gusset that follows an overhang's edge round and back to
// the side. Pinned on hoop_tab.stl -- a 2.5 mm plate with a rounded 1.5 mm tab sticking
// 4.7 mm out of it, a 2.2 mm hole through the tab -- printed plate upright: the hoop runs
// round the tab's edge, leaves the hole open, is tined to the plate at both ends, and
// its underside climbs at the gusset angle along it. And on blocks: where an edge doesn't
// come back to the side, or another support stands in the way.

import { WEB, block, buildTopology, loadModel, analyze, isClosed, insideCount, assert, assertClose } from './_util.js';

const { hoopAt, HOOP } = await import(`${WEB}hoop.js`);
const { GUSSET } = await import(`${WEB}gusset.js`);
const { PROP } = await import(`${WEB}prop.js`);
const { boxGrid } = await import(`${WEB}fins/fill.js`);
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const OFF = { x: 0, y: 0, z: 0 };

/** The part `topo` posed `rot` and seated at `o`, face by face (ui/walls.js printTriangles). */
function posed(topo, rot, o) {
  const { pos } = topo, a = new Float64Array(pos.length);
  for (let i = 0; i < a.length; i += 3) {
    const x = pos[i], y = pos[i + 1], z = pos[i + 2];
    a[i] = rot[0] * x + rot[3] * y + rot[6] * z + o.x;
    a[i + 1] = rot[1] * x + rot[4] * y + rot[7] * z + o.y;
    a[i + 2] = rot[2] * x + rot[5] * y + rot[8] * z + o.z;
  }
  return a;
}

// The tab, modelled Y up: turned 90 deg about X so its Y is the print's Z (the plate
// stands on its edge, the tab sticks out of its +x face at y 10..11.5)
const TAB = (() => {
  const topo = loadModel('hoop_tab');
  const rot = [1, 0, 0, 0, 0, 1, 0, -1, 0];
  const offset = analyze(topo, 45, rot).offset;
  const at = (x, y, z) => [x + offset.x, -z + offset.y, y + offset.z];   // the file's frame -> print space
  return { topo, rot, offset, tris: posed(topo, rot, offset), at,
           side: at(2.5, 6, 7.5), over: at(6.5, 10, 7.5), hole: { c: at(4.809, 10, 7.56), r: 1.1 }, ledgeZ: 10 + offset.z };
})();
const tabHoop = (opts = {}) => hoopAt(TAB.side, TAB.over, [1, 0, 0], TAB.tris,
  { topo: TAB.topo, rot: TAB.rot, offset: TAB.offset, ...opts });
const offSide = (p) => p[0] - TAB.side[0];

Deno.test('hoop: round the tab’s edge, every station under the tab', () => {
  const r = tabHoop();
  assert(r.ok && r.hoop, `hoop failed: ${r.reason}`);
  for (const p of r.top) assertClose(p[2], TAB.ledgeZ, 1e-6, 'a station off the tab’s underside');
  // out round the end: past the hole, nearly to the tab's 4.66 mm tip
  assert(r.reach > 4.66 - PROP.th - HOOP.edgeIn - 0.1 && r.reach < 4.66, `reach ${r.reach.toFixed(2)}`);
  // ...and back: both ends at the plate, on either side of the hole
  const [a, b] = [r.top[0], r.top[r.top.length - 1]];
  for (const e of [a, b]) assert(offSide(e) < PROP.sideClear + PROP.th / 2 + HOOP.endSlack + 1e-6, 'an end off the side');
  assert((a[1] - TAB.hole.c[1]) * (b[1] - TAB.hole.c[1]) < 0, 'both ends on one side of the hole');
  assert(r.length > 2 * (r.reach - 1), `${r.length.toFixed(1)} mm long: not round the end`);
});

Deno.test('hoop: leaves the hole open — nothing of it under the hole', () => {
  const r = tabHoop({ tines: true });
  assert(r.ok, r.reason);
  for (const v of r.tris) {
    const d = Math.hypot(v[0] - TAB.hole.c[0], v[1] - TAB.hole.c[1]);
    assert(d > TAB.hole.r, `a vertex ${d.toFixed(2)} mm from the hole’s centre, inside its ${TAB.hole.r} mm`);
  }
});

Deno.test('hoop: tined to the side at BOTH ends, Tines box or not', () => {
  for (const tines of [false, true]) {
    const r = tabHoop({ tines });
    assert(r.ok, r.reason);
    // a side tine reaches the plate face (x = 2.5 in the file); count them by end
    const near = r.tris.filter((v) => offSide(v) < 0.05);
    const ends = new Set(near.map((v) => (v[1] < TAB.hole.c[1] ? 'lo' : 'hi')));
    assert(ends.size === 2, `side tines at ${[...ends].join(', ') || 'neither end'} (Tines ${tines})`);
    assert(r.sideTines >= 4, `${r.sideTines} side tines`);
  }
});

Deno.test('hoop: its underside climbs at the gusset angle along it, deepest at the ends', () => {
  const r = tabHoop();
  assert(r.ok, r.reason);
  const slope = Math.tan((GUSSET.angle * Math.PI) / 180);
  let s = 0;
  for (let k = 1; k < r.top.length; k++) {
    const ds = Math.hypot(r.top[k][0] - r.top[k - 1][0], r.top[k][1] - r.top[k - 1][1]);
    s += ds;
    if (r.floors[k] === 0 || r.floors[k - 1] === 0) continue;
    assert(Math.abs(r.floors[k] - r.floors[k - 1]) <= slope * ds + 1e-6, `underside steeper than ${GUSSET.angle} deg at ${s.toFixed(1)} mm`);
  }
  const mid = Math.max(...r.floors);
  assert(r.floors[0] < mid && r.floors[r.floors.length - 1] < mid, 'not deepest at the ends');
  assertClose(TAB.ledgeZ - PROP.gap - mid, Math.max(GUSSET.endDepth, PROP.minHeight + PROP.footGap + 0.1), 0.01, 'depth half way round');
});

Deno.test('hoop: watertight, and only its tines bite into the part', () => {
  const r = tabHoop({ tines: true });
  assert(r.ok, r.reason);
  assert(isClosed(r.tris), 'hoop is not a closed solid');
  // the body stands clear: no vertex inside the part but a side tine's, in the plate's skin
  const inside = r.tris.filter((v) => insideCount(TAB.topo, TAB.rot, TAB.offset, [v]) > 0);
  for (const v of inside) assert(offSide(v) > -0.05 && offSide(v) < 0.05 || v[2] > TAB.ledgeZ - 0.05,
    `a vertex inside the part at ${v.map((c) => c.toFixed(2))}`);
});

// Blocks: a 5 mm upright 30 mm tall with a 20 mm arm on top, all 20 mm deep in y, in
// print space as is (no pose)
const topoOf = (...boxes) => {
  const pos = new Float32Array(boxes.flatMap((b) => [...block(...b)]));
  return buildTopology({ getAttribute: (k) => (k === 'position' ? { array: pos } : null) });
};
const UPRIGHT = [0, 5, 0, 20, 0, 30];
const at = (topo, o, opts = {}) => hoopAt([5, 10, 20], o, [1, 0, 0], topo.pos, { topo, rot: IDENTITY, offset: OFF, ...opts });

Deno.test('hoop: refused where the overhang’s edge never comes back to the side, or there’s none', () => {
  // the arm floats 2 mm off the upright: its edge runs round on its own
  const apart = topoOf(UPRIGHT, [7, 25, 0, 20, 30, 35]);
  const r = at(apart, [15, 10, 30]);
  assert(!r.ok && /doesn’t come back/.test(r.reason), `floating arm: ${r.reason ?? 'ok'}`);
  // a click past the arm's end, under open sky
  const L = topoOf(UPRIGHT, [0, 25, 0, 20, 30, 35]);
  const sky = at(L, [30, 10, 30]);
  assert(!sky.ok && /no edge to follow/.test(sky.reason), `open sky: ${sky.reason ?? 'ok'}`);
});

Deno.test('hoop: round a narrow arm, and kept clear of the supports standing', () => {
  // a 6 mm wide arm (y 7..13) on the full-depth upright: the hoop runs round all three
  // of its free edges
  const topo = topoOf(UPRIGHT, [0, 15, 7, 13, 30, 35]);
  const r = at(topo, [12, 10, 30]);
  assert(r.ok, `narrow arm: ${r.reason}`);
  assert(r.reach > 15 - 5 - PROP.th - HOOP.edgeIn - 0.1, `reach ${r.reach.toFixed(2)}`);
  const ys = r.top.map((p) => p[1]);
  assert(Math.min(...ys) < 7 + 1 && Math.max(...ys) > 13 - 1, 'not along both long edges');
  // an Auto wall standing under the arm's end: refused, as a gusset is
  const g = boxGrid();
  const wall = [];
  const flat = block(13, 14, 0, 20, 0, 29.8);
  for (let i = 0; i < flat.length; i += 3) wall.push([flat[i], flat[i + 1], flat[i + 2]]);
  g.add(wall);
  const clash = at(topo, [12, 10, 30], { supports: g });
  assert(!clash.ok && /fuse/.test(clash.reason), `built into a wall: ${clash.reason ?? 'ok'}`);
});

// An eyelet on a rim: eyelet_rim.stl is a tube (1.5 mm walls, 89.5 mm tall, modelled Y
// up) with a 2 mm lip round the inside at each end and eyelets reaching in off the
// lips. The eyelet's edge never comes back to the tube's curved wall -- it runs into the
// lip -- so the hoop follows the eyelet down to the lip and legs it to the wall from there.
const RIM = (() => {
  const topo = loadModel('eyelet_rim');
  const rot = [1, 0, 0, 0, 0, 1, 0, -1, 0];
  const offset = analyze(topo, 45, rot).offset;
  const at = (x, y, z) => [x + offset.x, -z + offset.y, y + offset.z];
  return { topo, rot, offset, tris: posed(topo, rot, offset), at, hole: { c: at(13.601, 0, -7.891), r: 1.095 } };
})();

Deno.test('hoop: round an eyelet on a rim, legged to the curved wall under the lip, at either end of the tube', () => {
  for (const [lip, y, oy] of [['top', 70, 79], ['bottom', -7.9, -5]]) {
    const r = hoopAt(RIM.at(13.6, y, -10.9), RIM.at(13.6, oy, -6.4), [0, 0, 1], RIM.tris,
                     { topo: RIM.topo, rot: RIM.rot, offset: RIM.offset, tines: true });
    assert(r.ok, `${lip} lip: ${r.reason}`);
    // round the far side of the hole; its top, the contact, never under the hole -- the
    // eyelet's ring is about a wall wide on one side, so the body below the contact may
    // reach a little way under the hole's rim, never across it
    assert(Math.min(...r.top.map((p) => p[1])) < RIM.hole.c[1] - RIM.hole.r, `${lip}: not round the eyelet`);
    const zTop = Math.max(...r.top.map((p) => p[2])) - PROP.gap;
    for (const v of r.tris) {
      const d = Math.hypot(v[0] - RIM.hole.c[0], v[1] - RIM.hole.c[1]);
      const contact = v[2] > zTop - 0.05;
      assert(d > RIM.hole.r - (contact ? 0 : 0.25), `${lip}: a ${contact ? 'contact ' : ''}vertex ${d.toFixed(2)} mm from the hole’s centre`);
    }
    // its ends on either side of the eyelet, both tined to the wall
    const [a, b] = [r.top[0], r.top[r.top.length - 1]];
    assert((a[0] - RIM.hole.c[0]) * (b[0] - RIM.hole.c[0]) < 0, `${lip}: both ends on one side of the eyelet`);
    assert(r.sideTines >= 2, `${lip}: ${r.sideTines} side tines`);
  }
});

// A round boss through a wall: boss_tube.stl is a rounded-rectangle tube (1.5 mm walls,
// 78.7 mm tall, modelled Y up) with a horizontal 8.8 mm boss through its left wall near
// the top, a 4 mm hole along it, sticking 6.5 mm in and 4 mm out, a groove round the
// outside part. The boss's underside is round and the groove steps it: the fins' tops
// settle under both (gusset.js settled, sweptClear) instead of being refused.
const BOSS = (() => {
  const topo = loadModel('boss_tube');
  const rot = [1, 0, 0, 0, 0, 1, 0, -1, 0];
  const offset = analyze(topo, 45, rot).offset;
  const at = (x, y, z) => [x + offset.x, -z + offset.y, y + offset.z];
  return { topo, rot, offset, tris: posed(topo, rot, offset), at };
})();

Deno.test('round boss: gussets under it on and off its axis, in and out of the tube, and a hoop round it', async () => {
  const { gussetAt } = await import(`${WEB}gusset.js`);
  const opts = { topo: BOSS.topo, rot: BOSS.rot, offset: BOSS.offset };
  const cases = [
    ['gusset inside, on the axis', gussetAt, [1, 0, 0], [-13.28, 62, 0.2], [-7.5, 70, 0.2]],
    ['gusset inside, 1.8 mm off it', gussetAt, [1, 0, 0], [-13.28, 62, 2], [-7.5, 70, 2]],
    ['gusset outside, under the grooved flange', gussetAt, [-1, 0, 0], [-14.78, 62, 0.2], [-18.3, 70, 0.2]],
    ['hoop inside, round the boss', hoopAt, [1, 0, 0], [-13.28, 62, 0.2], [-7.5, 70, 0.2]],
  ];
  for (const [name, f, n, w, o] of cases) {
    const r = f(BOSS.at(...w), BOSS.at(...o), n, BOSS.tris, opts);
    assert(r.ok, `${name}: ${r.reason}`);
    assert(r.sideTines >= 2, `${name}: ${r.sideTines} side tines`);
    // Tines off: only the side tines' ends are in the part, in the wall's skin
    const inside = r.tris.filter((v) => insideCount(BOSS.topo, BOSS.rot, BOSS.offset, [v]) > 0);
    for (const v of inside) {
      assert(Math.abs(v[0] - BOSS.at(...w)[0]) < 0.05, `${name}: a vertex inside the part at ${v.map((c) => c.toFixed(2))}`);
    }
  }
});
