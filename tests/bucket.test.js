// Draw's paint bucket (web/fins/bucket.js): a click on a red overhang fills that one
// overhang with the support picked, as walls drawn by hand. Each comes back as the
// clicks Draw stores, and each must stand again from them (draw.js drawnWall, gusset.js
// gussetAt / hoop.js hoopAt), the way the page re-stands drawn supports.
import { fileURLToPath } from 'node:url';
import { buildTopology, analyze, loadModel, assert, readSTL } from './_util.js';
import { bucketFill, pieces } from '../web/fins/bucket.js';
import { drawnWall } from '../web/draw.js';
import { gussetAt } from '../web/gusset.js';
import { hoopAt } from '../web/hoop.js';
import { seatedPartTris } from '../web/fins/seating.js';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const UP = [1, 0, 0, 0, 0, 1, 0, -1, 0];
const example = (name) => {
  const pos = readSTL(Deno.readFileSync(`${FIXTURES}${name}.stl`));
  return buildTopology({ getAttribute: (k) => (k === 'position' ? { array: pos } : null) });
};
const OPTS = { tines: true, coverage: 0.5 };

/** The region's mean height after `rot` (to pick the overhang under the boss). */
function heightOf(topo, rot, g) {
  let s = 0;
  for (const f of g.faces) for (let v = 0; v < 3; v++) {
    const i = (f * 3 + v) * 3, p = topo.pos;
    s += rot[2] * p[i] + rot[5] * p[i + 1] + rot[8] * p[i + 2];
  }
  return s / (g.faces.length * 3);
}

/** Every wall in `r` stands again from its clicks, and runs over its own overhang. */
function standsAgain(topo, res, rot, r) {
  const tris = seatedPartTris(topo, rot, res.offset);
  const ctx = { topo, rot, offset: res.offset };
  for (const w of r.walls) {
    const s = w.kind === 'gusset'
      ? (w.hoop ? hoopAt : gussetAt)(w.a, w.b, w.n, tris, ctx)
      : drawnWall(w.a, w.b, tris, 0, { ...ctx, ...(w.m ? { through: w.m } : {}) });
    if (!s.ok) return `a ${w.kind ?? (w.m ? 'curve' : 'line')} won't stand again: ${s.reason ?? s.why}`;
  }
  return null;
}

Deno.test('bucket: pieces — a straight top is one wall, a bent one arcs, a corner splits', () => {
  const straight = Array.from({ length: 21 }, (_, i) => [i, 0, 5]);
  const s = pieces(straight, true);
  assert(s.length === 1 && !s[0].m, `${s.length} pieces for a straight line`);
  const arc = Array.from({ length: 31 }, (_, i) => { const a = (i / 30) * Math.PI / 2; return [20 * Math.cos(a), 20 * Math.sin(a), 5]; });
  const c = pieces(arc, true);
  assert(c.length === 1 && c[0].m, `${c.length} pieces for a quarter circle`);
  const l = pieces(arc, false);
  assert(l.length >= 3 && l.every((w) => !w.m), `${l.length} straight pieces for it`);
  const ell = [...Array.from({ length: 11 }, (_, i) => [i, 0, 5]), ...Array.from({ length: 10 }, (_, i) => [10, i + 1, 5])];
  assert(pieces(ell, false).length === 2, 'an L in one piece');
});

Deno.test('bucket: off the red — nothing, and says so', () => {
  const topo = loadModel('hoop_tab'), res = analyze(topo, 45, UP);
  const f = Array.from({ length: topo.nFaces }, (_, i) => i).find((i) => !res.over[i]);
  const r = bucketFill(topo, res, UP, f, 'line', OPTS);
  assert(!r.ok && /red overhang/.test(r.why), r.why);
});

Deno.test('bucket: the spiral ramp — Curve lays arcs along it, Line straight pieces', () => {
  const topo = example('issue25_spiral'), res = analyze(topo, 45, IDENTITY);
  const g = res.regions[0];
  const c = bucketFill(topo, res, IDENTITY, g.faces[0], 'curve', OPTS);
  assert(c.ok && c.walls.some((w) => w.m), `${c.walls?.length} walls, none curved`);
  let why = standsAgain(topo, res, IDENTITY, c);
  assert(!why, why);
  const l = bucketFill(topo, res, IDENTITY, g.faces[0], 'line', OPTS);
  assert(l.ok && l.walls.every((w) => !w.m && !w.kind), 'Line laid a curve or a gusset');
  why = standsAgain(topo, res, IDENTITY, l);
  assert(!why, why);
});

Deno.test('bucket: the boss half way up the tube — Gusset under its flange, a Line in the groove Auto skips', () => {
  const topo = loadModel('boss_tube'), res = analyze(topo, 45, UP);
  const at = (g) => heightOf(topo, UP, g) + res.offset.z;
  // the flange under the boss: gussets off the tube, reaching out to it and no other
  const flange = res.regions.find((g) => Math.abs(at(g) - 69.7) < 1);
  const r = bucketFill(topo, res, UP, flange.faces[0], 'gusset', OPTS);
  assert(r.ok && r.walls.every((w) => w.kind === 'gusset' && !w.hoop), `${r.walls?.length} gussets: ${r.why}`);
  let why = standsAgain(topo, res, UP, r);
  assert(!why, why);
  for (const w of r.walls) assert(Math.abs(w.b[2] - at(flange)) < 3, `a gusset reaching to ${w.b[2].toFixed(1)} mm`);
  // the narrow groove roof above it: Auto calls it a small hole and leaves it bare, but
  // it was clicked, so a wall goes in -- and no gusset, with no side under it to stand on
  const groove = res.regions.find((g) => Math.abs(at(g) - 74.7) < 0.5);
  const l = bucketFill(topo, res, UP, groove.faces[0], 'line', OPTS);
  assert(l.ok && l.walls.length >= 1, `the groove: ${l.why}`);
  why = standsAgain(topo, res, UP, l);
  assert(!why, why);
  const g = bucketFill(topo, res, UP, groove.faces[0], 'gusset', OPTS);
  assert(!g.ok && /upright side/.test(g.why), 'a gusset with no side under it');
});

Deno.test('bucket: the tab with a hole — Hoop goes round it, Line finds no wall', () => {
  const topo = loadModel('hoop_tab'), res = analyze(topo, 45, UP);
  const g = res.regions[0];
  const h = bucketFill(topo, res, UP, g.faces[0], 'hoop', OPTS);
  assert(h.ok && h.walls.length === 1 && h.walls[0].hoop, `${h.walls?.length} hoops`);
  const why = standsAgain(topo, res, UP, h);
  assert(!why, why);
});
