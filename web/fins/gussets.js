/**
 * Auto's gussets and hoops (the "Auto can use" boxes; gusset.js, hoop.js).
 *
 * Auto stands its walls on the plate (or on the part under them). A gusset stands off
 * a SIDE of the part instead, so it is the better support in two places:
 *
 *   - where no wall reached: Plate only with part under the overhang, the inside of a
 *     tube, a lip too low or too boxed in for a wall's foot -- the red Auto left bare;
 *   - where the wall that reached is much taller than a gusset would be: a boss half
 *     way up a tube gets a 40 mm wall from the plate for a 6 mm reach off the tube.
 *
 * Everything else stays Auto's: a short wall is sturdy and leaves no tine marks up the
 * side. So the rules, in order:
 *
 *   1. the plate wall Auto built stays unless it is AUTO_GUSSET.taller x the gussets
 *      that would replace it AND those gussets hold AUTO_GUSSET.held of the red it held
 *      alone (measured as Full coverage measures it: coverage.js reachOf);
 *   2. the red still bare after that gets gussets off the nearest upright side;
 *   3. a hoop where the overhang there has a hole in it (a gusset straight out would
 *      run under the hole), or where a gusset can't be stood;
 *   4. whatever none of those could hold stays bare, and the readout says so.
 *
 * Each one is built by gusset.js / hoop.js exactly as a drawn one is (clearance, side,
 * other supports), from a "click" found here: the side nearest a red point, just
 * under it, and the overhang out to its edge along that side's normal.
 */
import { GUSSET, gussetAt, gussetDir, undersideAt } from '../gusset.js';
import { edgesFrom, hoopAt } from '../hoop.js';
import { insidePart } from '../inside.js';
import { PROP } from '../prop.js';
import { bends } from '../prop/curved.js';
import { classify, reachOf } from './coverage.js';
import { boxGrid, fillReach, leftoverPoints } from './fill.js';
import { seatedPartTris } from './seating.js';

export const AUTO_GUSSET = {
  taller: 3,        // a wall this many times the gussets' height gives way to them...
  minWall: 10,      // mm: ...and never one shorter than this
  held: 0.95,       // the gussets must hold this share of the red the wall held alone
  rays: 16,         // directions the side is looked for in, round a red point
  under: 0.5,       // mm under the underside the side is looked for
  ray: 0.5,         // mm: the look's step (refined to 0.05 on a hit)
  rise: 3,          // mm: the underside climbing more than this ends the overhang
  tries: 60,        // red points tried for the bare red
  wallTries: 40,    // red points tried per tall wall
  swaps: 12,        // tall walls tried, tallest first
  skip: 2,          // mm: a red point this near one that failed isn't tried again
};

/**
 * `built` (Auto's) with its gussets and hoops added, and the walls they replace
 * removed. `opts.autoGussets` / `opts.autoHoops` say which may be used;
 * `opts.straightWalls === false` drops Auto's straight walls first (the curved ones
 * stay), so the gussets and hoops are all that holds what they held.
 */
export function autoGussets(topo, result, rot, opts, built) {
  const gussets = opts.autoGussets === true, hoops = opts.autoHoops === true;
  if (opts.straightWalls === false) built = dropFins(built, new Set(built.fins.filter((f) => straight(f, built))));
  if (!gussets && !hoops) return built;
  const tris = seatedPartTris(topo, rot, result.offset);
  const R = fillReach(Math.max(0, Math.min(1, opts.coverage ?? 0.5)));
  const ctx = { topo, rot, offset: result.offset, tris, gussets, hoops,
                fin: { topo, rot, offset: result.offset, tines: opts.tines !== false,
                       tineDensity: opts.tineDensity, layerHeight: opts.layerHeight } };
  const cls = classify(topo, result, rot);
  const holds = (fins) => {
    const tops = [];
    for (const f of fins) if (f.kind !== 'sway') for (const p of f.line ?? []) tops.push(p);
    return reachOf(tops, R);
  };
  const sum = (pts) => pts.reduce((s, p) => s + p[3], 0);
  const stats = { gussets: 0, hoops: 0, swapped: 0, tried: 0 };
  const placed = [];

  // 1. Tall walls, tallest first: the red each holds that nothing staying holds -- the
  // other tall walls may go too (a row of them under one lip each hold it all) --
  // tried with gussets. (By id: dropFins hands back copies.)
  if (opts.straightWalls !== false) {
    const pending = new Set(built.fins.filter((f) => f.kind === 'prop' && (f.height ?? 0) >= AUTO_GUSSET.minWall)
      .sort((a, b) => b.height - a.height).slice(0, AUTO_GUSSET.swaps).map((f) => f.id));
    for (const id of [...pending]) {
      pending.delete(id);
      const wall = built.fins.find((f) => f.id === id);
      const staying = built.fins.filter((f) => f.id !== id && !pending.has(f.id));
      const byRest = holds([...staying, ...placed.map((g) => g.fin)]), byWall = holds([wall]);
      const alone = leftoverPoints(topo, result, rot, (x, y, z) => byRest(x, y, z) || !byWall(x, y, z), cls);
      if (!alone.length) continue;
      const others = gridOf(built, result, wall, placed);
      const near = reachOf([], R);
      const got = fill(ctx, alone, others, near, AUTO_GUSSET.wallTries, stats);
      if (!got.length) continue;
      const height = Math.max(...got.map((g) => g.r.height));
      const held = sum(alone.filter((p) => near(p[0], p[1], p[2])));
      // (a wall that stays holds its red for the walls still to come)
      if (wall.height < AUTO_GUSSET.taller * height || held < AUTO_GUSSET.held * sum(alone)) continue;
      built = dropFins(built, new Set([wall]));
      placed.push(...got);
      stats.swapped++;
    }
  }

  // 2 + 3. The red still bare.
  const near = holds([...built.fins, ...placed.map((g) => g.fin)]);
  const bare = leftoverPoints(topo, result, rot, near, cls);
  if (bare.length) placed.push(...fill(ctx, bare, gridOf(built, result, null, placed), near, AUTO_GUSSET.tries, stats));
  if (!placed.length) return { ...built, autoGussets: stats };

  // Appended as the short walls are: triangles after Auto's, a fin record each.
  const triangles = [...built.triangles];
  let id = built.fins.reduce((m, f) => Math.max(m, (f.id ?? -1) + 1), built.fins.length);
  const fins = [...built.fins];
  let tines = 0;
  for (const g of placed) {
    const at = triangles.length;
    for (const v of g.r.tris) triangles.push(v);
    fins.push({ ...g.fin, id: id++, triRanges: [[at, triangles.length]] });
    tines += g.r.tines + g.r.sideTines;
    if (g.r.hoop) stats.hoops++; else stats.gussets++;
  }
  const withTines = opts.tines !== false;
  return { ...built, triangles, fins, tines: (built.tines ?? 0) + tines,
           braceCount: (built.braceCount ?? 0) + (withTines ? placed.length : 0),
           propCount: (built.propCount ?? 0) + (withTines ? 0 : placed.length),
           autoGussets: { ...stats, tined: withTines } };
}

/** Gussets (and hoops) for the red points `red`, most red first, up to `budget` tries:
 *  each one built is added to `others` (to keep clear of) and `near` (what it holds). */
function fill(ctx, red, others, near, budget, stats) {
  const out = [], failed = [];
  const order = [...red].sort((a, b) => b[3] - a[3]);
  let tries = 0;
  for (const p of order) {
    if (tries >= budget) break;
    if (near(p[0], p[1], p[2])) continue;
    if (failed.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) < AUTO_GUSSET.skip)) continue;
    tries++;
    stats.tried++;
    const g = finFor(ctx, p, others);
    if (!g) { failed.push(p); continue; }
    others.add(g.r.tris);
    for (const q of g.fin.line) near.add(q);
    out.push(g);
  }
  return out;
}

/** The gusset or hoop that holds red point `p`, or null. */
function finFor(ctx, p, others) {
  const { tris } = ctx;
  const z = p[2] - AUTO_GUSSET.under;
  for (const s of sidesNear(ctx, p, z)) {
    const opts = { ...ctx.fin, supports: others };
    // a hole in the overhang here: a gusset straight out would run under it
    const holed = ctx.hoops && (edgesFrom(ctx.topo, ctx.rot, tris, p, z) ?? []).some((e) => e.closed);
    const hoop = () => (ctx.hoops ? hoopAt(s.w, p, s.face, tris, opts) : null);
    let r = holed ? hoop() : null;
    if (!r?.ok && ctx.gussets) {
      const reach = reachOut(tris, s.w, s.dir, z);
      for (const u of [reach, reach * 0.7]) {
        if (u < GUSSET.minReach) break;
        r = gussetAt(s.w, [s.w[0] + s.dir[0] * u, s.w[1] + s.dir[1] * u, p[2]], s.face, tris, opts);
        if (r.ok) break;
      }
    }
    if (!r?.ok && !holed) r = hoop();
    if (r?.ok) {
      return { r, fin: { kind: 'gusset', ...(r.hoop ? { hoop: true } : {}), auto: true,
                         height: r.height, length: r.hoop ? r.length : r.reach, span: r.hoop ? r.length : r.reach,
                         tines: r.tines + r.sideTines, rows: 0, stilt: 0, lean: 0, bearing: 0, site: null,
                         line: r.top.map((q) => [q[0], q[1], q[2] - PROP.gap]) } };
    }
  }
  return null;
}

/** The upright sides round `p` at height `z`, nearest first (at most two): where the
 *  look hit the solid (`w`), the face there and its levelled outward normal (`dir`). */
function sidesNear(ctx, p, z) {
  const { topo, rot, offset, tris } = ctx;
  const solid = (x, y) => insidePart(topo, rot, offset, x, y, z);
  if (solid(p[0], p[1])) return [];
  const hits = [];
  let best = GUSSET.maxReach + 1;
  for (let k = 0; k < AUTO_GUSSET.rays; k++) {
    const a = (2 * Math.PI * k) / AUTO_GUSSET.rays, dx = Math.cos(a), dy = Math.sin(a);
    for (let t = AUTO_GUSSET.ray; t <= best + 2; t += AUTO_GUSSET.ray) {
      if (!solid(p[0] + dx * t, p[1] + dy * t)) continue;
      while (t > 0.05 && solid(p[0] + dx * (t - 0.05), p[1] + dy * (t - 0.05))) t -= 0.05;
      hits.push({ t, w: [p[0] + dx * t, p[1] + dy * t, z] });
      best = Math.min(best, t);
      break;
    }
  }
  hits.sort((a, b) => a.t - b.t);
  const out = [];
  for (const h of hits) {
    const face = nearestFace(tris, h.w);
    if (face < 0) continue;
    const dir = gussetDir(topo, rot, face);
    if (!dir || out.some((s) => s.face === face || s.dir[0] * dir[0] + s.dir[1] * dir[1] > 0.9)) continue;
    // the fin runs out from the side TOWARDS the red
    if ((p[0] - h.w[0]) * dir[0] + (p[1] - h.w[1]) * dir[1] <= 0) continue;
    out.push({ w: h.w, face, dir });
    if (out.length === 2) break;
  }
  return out;
}

/** How far out from `w` along `dir` the overhang runs: until its underside climbs
 *  AUTO_GUSSET.rise over where it started, or stops. */
function reachOut(tris, w, dir, z) {
  let z0 = null, last = 0;
  for (let u = 0.5; u <= GUSSET.maxReach; u += 0.5) {
    const zu = undersideAt(tris, w[0] + dir[0] * u, w[1] + dir[1] * u, z);
    if (zu === null) break;
    z0 ??= zu;
    if (zu > z0 + AUTO_GUSSET.rise) break;
    last = u;
  }
  return Math.max(0, last - 0.3);
}

/** The face nearest `q` (by its triangle's closest point), or -1. */
function nearestFace(tris, q) {
  let best = -1, dBest = 0.5;
  for (let f = 0; f * 9 < tris.length; f++) {
    const o = f * 9;
    const lo = (i) => Math.min(tris[o + i], tris[o + 3 + i], tris[o + 6 + i]);
    const hi = (i) => Math.max(tris[o + i], tris[o + 3 + i], tris[o + 6 + i]);
    if (q[0] < lo(0) - dBest || q[0] > hi(0) + dBest || q[1] < lo(1) - dBest || q[1] > hi(1) + dBest
        || q[2] < lo(2) - dBest || q[2] > hi(2) + dBest) continue;
    const d = pointTri(q, tris, o);
    if (d < dBest) { dBest = d; best = f; }
  }
  return best;
}

/** Distance from `p` to the triangle at `t[o..o+8]`. */
function pointTri(p, t, o) {
  const a = [t[o], t[o + 1], t[o + 2]], b = [t[o + 3], t[o + 4], t[o + 5]], c = [t[o + 6], t[o + 7], t[o + 8]];
  const sub = (u, v) => [u[0] - v[0], u[1] - v[1], u[2] - v[2]];
  const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  let q;
  if (d1 <= 0 && d2 <= 0) q = a;
  else {
    const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
    const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
    const vc = d1 * d4 - d3 * d2, vb = d5 * d2 - d1 * d6, va = d3 * d6 - d5 * d4;
    if (d3 >= 0 && d4 <= d3) q = b;
    else if (d6 >= 0 && d5 <= d6) q = c;
    else if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); q = [a[0] + ab[0] * v, a[1] + ab[1] * v, a[2] + ab[2] * v]; }
    else if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); q = [a[0] + ac[0] * w, a[1] + ac[1] * w, a[2] + ac[2] * w]; }
    else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
      const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
      q = [b[0] + (c[0] - b[0]) * w, b[1] + (c[1] - b[1]) * w, b[2] + (c[2] - b[2]) * w];
    } else {
      const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
      q = [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w];
    }
  }
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

/** What a new gusset must keep clear of: `built`'s supports but `without`'s, the
 *  excluded cavities, and the gussets `placed` so far. */
function gridOf(built, result, without, placed) {
  const g = boxGrid();
  if (!without) g.add(built.triangles ?? []);
  else {
    const cut = (without.triRanges ?? []).slice().sort((a, b) => a[0] - b[0]);
    let at = 0;
    for (const [a, b] of cut) { g.add(built.triangles.slice(at, a)); at = Math.max(at, b); }
    g.add(built.triangles.slice(at));
  }
  g.add(result.excludedSupportVolumes ?? []);
  for (const p of placed) g.add(p.r.tris);
  return g;
}

/** Is fin `f` one of Auto's straight walls (a prop or wedge that doesn't bend)? */
function straight(f, built) {
  if (f.kind === 'wedge') return true;
  if (f.kind !== 'prop') return false;
  const q = built.props?.find((p) => p.line === f.line);
  return !(q?.downhill && bends([q]));
}

/** `built` without the fins in `drop` (and the props they are): their triangles cut
 *  out, every other range moved down to match. */
export function dropFins(built, drop) {
  if (!drop.size) return built;
  const cut = [...drop].flatMap((f) => f.triRanges ?? []).sort((a, b) => a[0] - b[0]);
  const triangles = [];
  let at = 0;
  for (const [a, b] of cut) { for (let i = at; i < a; i++) triangles.push(built.triangles[i]); at = Math.max(at, b); }
  for (let i = at; i < built.triangles.length; i++) triangles.push(built.triangles[i]);
  const moved = (i) => { let s = 0; for (const [a, b] of cut) if (b <= i) s += b - a; return i - s; };
  const remap = (rs) => (rs ?? []).map(([a, b]) => [moved(a), moved(b)]);
  const lines = new Set([...drop].map((f) => f.line));
  const fins = built.fins.filter((f) => !drop.has(f)).map((f) => ({ ...f, triRanges: remap(f.triRanges) }));
  const props = (built.props ?? []).filter((q) => !lines.has(q.line)).map((q) => ({ ...q, triRanges: remap(q.triRanges) }));
  const tines = [...drop].reduce((s, f) => s + (f.tines ?? 0), 0);
  const withTines = (built.braceCount ?? 0) > 0;
  return { ...built, triangles, fins, props, tines: Math.max(0, (built.tines ?? 0) - tines),
           braceCount: withTines ? Math.max(0, (built.braceCount ?? 0) - drop.size) : built.braceCount,
           propCount: withTines ? built.propCount : Math.max(0, (built.propCount ?? 0) - drop.size) };
}
