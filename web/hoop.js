/**
 * GUSSET HOOPS -- a gusset that follows an overhang's EDGE instead of running straight
 * out: off the side, out along one flank of a tab, round its end and back, leaving the
 * middle open (a tab with a screw hole in it keeps its hole clean).
 *
 *        side                    plan, from above
 *   ██████████████
 *   ██    ╭──────────╮          ── the hoop, just inside the tab's edge
 *   ██≡  ╱  ╭────╮   │          ≡  side tines at BOTH ends
 *   ██   │  │ () │   │          () a hole the hoop leaves open
 *   ██≡  ╲  ╰────╯   │
 *   ██    ╰──────────╯
 *
 * The tab may stand straight off the side, or off a lip that runs along it (an eyelet
 * on a rim): then the hoop follows the tab down to the lip and runs straight to the
 * side under it from there, its two legs.
 *
 * A gusset in every other way (gusset.js): its top is the tip under the overhang, its
 * ends stand off the side and are tined to it, it keeps clear of the part and the other
 * supports the same way. Its underside climbs at GUSSET.angle ALONG the hoop from each
 * end, so every layer of its bottom edge sits on the one below -- deepest where it meets
 * the side, GUSSET.endDepth under the overhang half way round.
 *
 * Placement is by hand (Draw > Hoop): a click on the side, then a click on the overhang.
 */
import { insidePart } from './inside.js';
import { PROP, emitTines, tineStepFor, crestOn, crestPart } from './prop.js';
import { clearBetween, trimmedEnds } from './prop/attached.js';
import { GUSSET, gussetDir, undersideAt, settled, sweptClear, sideHolds, sideTinesAt, refused, intoPart } from './gusset.js';

export const HOOP = {
  downCos: 0.5,     // a face is part of the overhang when its normal points down this much (60 deg off upright)
  edgeIn: 0.15,     // mm: the hoop's outer face stands this far inside the overhang's edge
  step: 0.5,        // mm between stations round the hoop: an edge curls tighter than a wall's 1 mm
  pick: 8,          // mm round the click: the tab's tip is the edge furthest from the side within this
  level: 0.15,      // mm: an edge closing on the side by less than this over the next mm has left the tab...
  levelBelow: 1,    // mm: ...once it is this far nearer the side than the tab's tip (a round tip closes slowly too)
  endSlack: 1.0,    // mm: how much further off the side clearance may trim an end before it can't be tined
  maxLength: 120,   // mm round: past this it's a fence, not a hoop
};

/**
 * The hoop off the side at `w` (print space, a point on the side `side`: its face index
 * or its normal, as gusset.js's `sideNormal`) round the tab of the overhang clicked at
 * `o`. `tris`: the part in print space, face by face in the topology's order; `opts` as
 * gussetAt's.
 *
 * Returns { ok: true, hoop: true, tris, reach, length, height, angle, tines, sideTines,
 * top, floors } or a refusal as gussetAt's.
 */
export function hoopAt(w, o, side, tris, opts) {
  const { topo, rot, offset } = opts;
  const dir = gussetDir(topo, rot, side);
  if (!dir) return { ok: false, reason: 'start a gusset on a side of the part — an upright face under the overhang' };
  const [nx, ny] = dir;
  const angle = Math.max(GUSSET.minAngle, Number.isFinite(opts.angle) ? opts.angle : GUSSET.angle);
  const slope = Math.tan((angle * Math.PI) / 180);
  const layerH = opts.layerHeight ?? PROP.tineH;
  const zU = undersideAt(tris, o[0], o[1], w[2]);
  if (zU === null) return { ok: false, reason: 'no edge to follow there — click on the overhang the hoop should run round' };

  // How far the side is from (x, y), straight back along the side's normal, just under
  // the overhang: the side itself, wherever it curves, not the clicked face's plane.
  const toSide = (p) => {
    const solid = (t) => insidePart(topo, rot, offset, p[0] - nx * t, p[1] - ny * t, zU - 0.3);
    for (let t = 0; t <= GUSSET.maxReach + 1; t += 0.25) {
      if (!solid(t)) continue;
      while (t > 0.05 && solid(t - 0.05)) t -= 0.05;   // back to the face, to 0.05 mm
      return t;
    }
    return Infinity;
  };

  const edges = edgesFrom(topo, rot, tris, o, w[2]);
  const run = edges && tabRun(edges, o, toSide);
  if (!run) return { ok: false, reason: 'no edge to follow there — click on the overhang the hoop should run round' };

  // Moved in so the outer face stands HOOP.edgeIn inside the edge; the ends that came
  // nearer the side than d0 cut back to it, the rest given a straight leg to it
  const d0 = PROP.sideClear + PROP.th / 2;   // the end cap's corners stand a flank off the side
  let line = inset(resampled(run, HOOP.step / 2), PROP.th / 2 + HOOP.edgeIn, edges);
  while (line.length > 2 && toSide(line[0]) < d0) line.shift();
  while (line.length > 2 && toSide(line[line.length - 1]) < d0) line.pop();
  if (line.length < 3) return { ok: false, reason: 'no edge to follow there — click on the overhang the hoop should run round' };
  const leg = (p) => {
    const t = toSide(p);
    if (!Number.isFinite(t)) return null;
    const out = [];
    for (let s = HOOP.step; s < t - d0; s += HOOP.step) out.push([p[0] - nx * s, p[1] - ny * s]);
    if (t - d0 > 0.05) out.push([p[0] - nx * (t - d0), p[1] - ny * (t - d0)]);
    return out;
  };
  const legA = leg(line[0]), legB = leg(line[line.length - 1]);
  if (!legA || !legB) return { ok: false, reason: 'the overhang’s edge doesn’t come back to this side — use a gusset instead' };
  const pts = resampled([...legA.reverse(), ...line, ...legB], HOOP.step);

  const length = arcLength(pts);
  let reach = 0;
  for (const p of run) reach = Math.max(reach, toSideCached(p, toSide));
  reach -= PROP.th / 2 + HOOP.edgeIn;
  if (reach < GUSSET.minReach) {
    return refused('gusset too short — reaches {reach}mm out from the side, needs {min}mm',
                   { reach: Math.max(0, reach).toFixed(1), min: GUSSET.minReach });
  }
  if (reach > GUSSET.maxReach) {
    return refused('gusset too long — {reach}mm out from the side, at most {max}mm; stand a wall on the plate instead',
                   { reach: reach.toFixed(0), max: GUSSET.maxReach });
  }
  if (length > HOOP.maxLength) {
    return refused('hoop too long — {len}mm round the edge, at most {max}mm',
                   { len: length.toFixed(0), max: HOOP.maxLength });
  }

  let top = [];
  for (const [x, y] of pts) {
    const z = undersideAt(tris, x, y, w[2]);
    // a leg that leaves the overhang crosses open air to the side: nothing to hold there
    if (z === null) return { ok: false, reason: 'the overhang’s edge doesn’t come back to this side — use a gusset instead' };
    top.push([x, y, z]);
  }
  settled(top, tris);

  // The underside: GUSSET.endDepth under the overhang half way round, climbing down at
  // `slope` along the hoop to each end. A station whose underside would sink under the
  // plate stands on it instead, as a gusset's does.
  const depth = Math.max(GUSSET.endDepth, PROP.minHeight + PROP.footGap + 0.1);
  const s = [0];
  for (let k = 1; k < top.length; k++) s.push(s[k - 1] + Math.hypot(top[k][0] - top[k - 1][0], top[k][1] - top[k - 1][1]));
  const half = s[s.length - 1] / 2;
  const zMid = Math.min(...top.map((p) => p[2])) - PROP.gap - depth;
  let floors = top.map((p, k) => {
    const fromEnd = Math.min(s[k], 2 * half - s[k]);
    const z = Math.min(zMid - (half - fromEnd) * slope, p[2] - PROP.gap - depth);
    return [p[0], p[1], z < 0.5 ? 0 : z];
  });

  // Clearance as a gusset's: the ends trimmed while clearBetween refuses them -- both
  // ends are held by side tines here, so neither may come in further than they reach --
  // then every station, then the swept body measured.
  const keep = trimmedEnds(top, floors, topo, rot, offset);
  if (!keep) return intoPart();
  top = top.slice(keep[0], keep[1]);
  floors = floors.slice(keep[0], keep[1]);
  const ends = [0, top.length - 1].map((k) => ({ k, u: toSide(top[k]) }));
  if (ends.some((e) => e.u > d0 + HOOP.endSlack)) return intoPart();
  for (let k = 1; k < top.length - 1; k++) {
    if (!clearBetween(top, floors, k, topo, rot, offset)) return intoPart();
  }

  // The side behind BOTH ends, all the way down each
  for (const e of ends) {
    e.zLo = floors[e.k][2] + PROP.footGap;
    e.zHi = top[e.k][2] - PROP.gap;
    const back = e.u + GUSSET.wallProbe;
    if (!sideHolds(topo, rot, offset, [top[e.k][0] - nx * back, top[e.k][1] - ny * back], e.zLo, e.zHi, layerH)) {
      return refused('the side doesn’t run far enough down for a gusset this long at {angle}° — reach less far, or start it lower on the side',
                     { angle });
    }
  }

  if (crestOn()) crestPart(tris, layerH);
  const out = sweptClear(top, floors, topo, rot, offset);
  if (!out) return intoPart();
  if (out.thin) return { ok: false, reason: 'too little room under the overhang there for a gusset' };
  let height = 0;
  for (let k = 0; k < top.length; k++) height = Math.max(height, top[k][2] - PROP.gap - floors[k][2]);

  let sideTines = 0;
  for (const e of ends) sideTines += sideTinesAt(topo, rot, offset, top[e.k], dir, e.u, e.zLo, e.zHi, layerH, out);
  const tines = opts.tines
    ? emitTines(top, tris, topo, rot, offset, out, tineStepFor(opts.tineDensity ?? 1), undefined, layerH)
    : 0;
  if (opts.supports?.hits(out, PROP.sideClear)) {
    return { ok: false, reason: 'the gusset would fuse with a support already standing there — place it clear of that support' };
  }
  return { ok: true, hoop: true, tris: out, reach, length: arcLength(top), height, angle, tines, sideTines,
           top, floors: floors.map((f) => f[2]) };
}

/** toSide, remembered per point (the run's points are walked more than once). */
const sideMemo = new WeakMap();
function toSideCached(p, toSide) {
  let d = sideMemo.get(p);
  if (d === undefined) sideMemo.set(p, (d = toSide(p)));
  return d;
}

/**
 * The stretch of free edge that is the tab, as plan points with the overhang on their
 * RIGHT. `edges`: [{ pts, closed }] (edgesFrom), resampled every quarter mm here. It
 * starts at the tab's tip -- the edge furthest from the side within HOOP.pick of the
 * click, on whichever edge that is, so a click beside a hole finds the tab round it,
 * not the hole -- then
 * runs down both flanks while they close on the side: to the side itself (a tab straight
 * off it), or to where the edge levels out along a lip (an eyelet on a rim). Null when
 * there's no such stretch.
 */
function tabRun(edges, o, toSide) {
  let edge = null, pts = null, i0 = -1, tipD = -Infinity;
  for (const e of edges) {
    const ps = resampled(e.pts, 0.25, e.closed);
    ps.forEach((p, i) => {
      if (Math.hypot(p[0] - o[0], p[1] - o[1]) > HOOP.pick) return;
      const d = toSideCached(p, toSide);
      if (Number.isFinite(d) && d > tipD) { tipD = d; edge = e; pts = ps; i0 = i; }
    });
  }
  if (!edge) return null;
  const N = pts.length;
  const step = (i, d) => (edge.closed ? (i + d + N) % N : i + d);
  const ok = (i) => edge.closed || (i >= 0 && i < N);
  const far = (i) => toSideCached(pts[i], toSide);
  const tip = far(i0), look = 4;   // a mm ahead, in quarter-mm samples
  const down = (d) => {
    let i = i0, walked = 0;
    while (walked < N / 2) {
      const j = step(i, d);
      if (!ok(j) || !Number.isFinite(far(j))) break;
      if (far(i) < 0.3) break;                                   // at the side
      const ahead = step(i, d * look);
      if (ok(ahead) && far(i) < tip - HOOP.levelBelow && far(i) - far(ahead) < HOOP.level) break;   // along a lip
      i = j;
      walked++;
    }
    return { i, walked };
  };
  const a = down(-1), b = down(1);
  if (a.walked + b.walked < 2) return null;
  const out = [];
  for (let i = a.i, n = 0; n <= a.walked + b.walked; i = step(i, 1), n++) out.push(pts[i]);
  return out;
}

/**
 * The overhang's free edges: [{ pts, closed }] in plan, the overhang on the right of the
 * way each runs, or null when there's no overhang under the click.
 *
 * The overhang is the patch of down-facing faces (HOOP.downCos) grown across the mesh
 * from the one under `o` -- the lowest above `zMin`, as undersideAt finds it. Its
 * boundary edges (used by one face of the patch) are where it meets the rest of the
 * part: ATTACHED where the face beyond runs down (a side under it), FREE where it runs
 * up (the overhang's own rim). The free edges chain into runs -- or whole loops: a hole,
 * or the inside of a rim.
 */
export function edgesFrom(topo, rot, tris, o, zMin) {
  const seed = seedFace(topo, rot, tris, o, zMin);
  if (seed < 0) return null;
  const patch = grow(topo, rot, seed);
  const { vid } = topo;
  const nbr = neighbours(topo);
  const at = new Map(), uses = new Map();
  const key = (a, b) => (a < b ? `${a},${b}` : `${b},${a}`);
  for (const f of patch) {
    for (let i = 0; i < 3; i++) {
      const a = vid[f * 3 + i], b = vid[f * 3 + ((i + 1) % 3)];
      if (!at.has(a)) at.set(a, [tris[f * 9 + i * 3], tris[f * 9 + i * 3 + 1], tris[f * 9 + i * 3 + 2]]);
      const k = key(a, b);
      uses.set(k, uses.has(k) ? null : [a, b, f]);
    }
  }
  // each boundary edge, as its face winds it (a down-facing face, so the patch is on its
  // right seen from above), free or attached
  const next = new Map(), free = new Map();
  for (const e of uses.values()) {
    if (!e) continue;
    const [a, b, f] = e;
    next.set(a, b);
    free.set(a, !runsDown(topo, tris, nbr, f, a, b));
  }
  // free runs: walk each loop, cutting it where it's attached
  const runs = [], seen = new Set();
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const loop = [];
    for (let v = start; v !== undefined && !seen.has(v); v = next.get(v)) { seen.add(v); loop.push(v); }
    const n = loop.length;
    const cut = loop.findIndex((v) => !free.get(v));
    if (cut < 0) { runs.push({ pts: loop.map((v) => at.get(v)), closed: true }); continue; }
    let run = null;
    for (let i = 1; i <= n; i++) {
      const v = loop[(cut + i) % n];
      if (free.get(v)) {
        run ??= [];
        run.push(at.get(v));
      } else if (run) {
        run.push(at.get(v));   // the free edge ends on this attached corner
        runs.push({ pts: run, closed: false });
        run = null;
      }
    }
  }
  return runs.filter((r) => r.pts.length >= 2);
}

/** Does the face across edge a-b from patch face `f` run down from the edge (a side
 *  under the overhang) rather than up (the overhang's rim)? */
function runsDown(topo, tris, nbr, f, a, b) {
  const { vid } = topo;
  for (let i = nbr.start[f]; i < nbr.start[f + 1]; i++) {
    const g = nbr.list[i];
    const c = [0, 1, 2].find((k) => vid[g * 3 + k] !== a && vid[g * 3 + k] !== b);
    if (c === undefined || [0, 1, 2].filter((k) => vid[g * 3 + k] === a || vid[g * 3 + k] === b).length !== 2) continue;
    const zc = tris[g * 9 + c * 3 + 2];
    let za = 0, zb = 0;
    for (let k = 0; k < 3; k++) {
      if (vid[g * 3 + k] === a) za = tris[g * 9 + k * 3 + 2];
      if (vid[g * 3 + k] === b) zb = tris[g * 9 + k * 3 + 2];
    }
    return zc < (za + zb) / 2 - 1e-3;
  }
  return false;
}

/** The down-facing face under (o[0], o[1]) whose height there is the underside the hoop
 *  holds (the lowest down-facing surface above `zMin`), or -1. */
function seedFace(topo, rot, tris, o, zMin) {
  const z = undersideAt(tris, o[0], o[1], zMin);
  if (z === null) return -1;
  for (let f = 0; f < topo.nFaces; f++) {
    if (downward(topo, rot, f) < HOOP.downCos) continue;
    const q = f * 9;
    const ax = tris[q], ay = tris[q + 1], bx = tris[q + 3], by = tris[q + 4], cx = tris[q + 6], cy = tris[q + 7];
    const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(det) < 1e-12) continue;
    const l1 = ((by - cy) * (o[0] - cx) + (cx - bx) * (o[1] - cy)) / det;
    const l2 = ((cy - ay) * (o[0] - cx) + (ax - cx) * (o[1] - cy)) / det;
    const l3 = 1 - l1 - l2;
    if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
    const zf = l1 * tris[q + 2] + l2 * tris[q + 5] + l3 * tris[q + 8];
    if (Math.abs(zf - z) < 0.05) return f;
  }
  return -1;
}

/** How far face `f` points down in print space (minus its normal's z). */
function downward(topo, rot, f) {
  const n = topo.nrm, i = f * 3;
  return -(rot[2] * n[i] + rot[5] * n[i + 1] + rot[8] * n[i + 2]);
}

/** The down-facing faces connected to `seed` across shared edges. */
function grow(topo, rot, seed) {
  const nbr = neighbours(topo);
  const inPatch = new Set([seed]), todo = [seed];
  while (todo.length) {
    const f = todo.pop();
    for (let i = nbr.start[f]; i < nbr.start[f + 1]; i++) {
      const g = nbr.list[i];
      if (!inPatch.has(g) && downward(topo, rot, g) >= HOOP.downCos) { inPatch.add(g); todo.push(g); }
    }
  }
  return inPatch;
}

/** Each face's neighbours across its edges, from the topology's adjacency pairs (CSR,
 *  kept on the topology like inside.js's grid). */
function neighbours(topo) {
  if (topo._hoopNbr) return topo._hoopNbr;
  const { adjA, adjB, nFaces } = topo;
  const start = new Int32Array(nFaces + 1);
  for (let e = 0; e < adjA.length; e++) { start[adjA[e] + 1]++; start[adjB[e] + 1]++; }
  for (let f = 0; f < nFaces; f++) start[f + 1] += start[f];
  const fill = start.slice(0, nFaces), list = new Int32Array(adjA.length * 2);
  for (let e = 0; e < adjA.length; e++) { list[fill[adjA[e]]++] = adjB[e]; list[fill[adjB[e]]++] = adjA[e]; }
  return (topo._hoopNbr = { start, list });
}

function arcLength(line, closed = false) {
  let s = 0;
  for (let i = 1; i < line.length; i++) s += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
  if (closed && line.length > 1) s += Math.hypot(line[0][0] - line[line.length - 1][0], line[0][1] - line[line.length - 1][1]);
  return s;
}

/** `line` re-cut into equal steps of at most `step`, its ends kept (a closed loop: round
 *  to its start, which isn't repeated). Points are [x, y]. */
function resampled(line, step, closed = false) {
  const src = closed ? [...line, line[0]] : line;
  const L = arcLength(src);
  const n = Math.max(1, Math.ceil(L / step));
  const out = [];
  let i = 0, s0 = 0;
  const seg = (k) => Math.hypot(src[k + 1][0] - src[k][0], src[k + 1][1] - src[k][1]);
  for (let k = 0; k <= (closed ? n - 1 : n); k++) {
    const s = (L * k) / n;
    while (i < src.length - 2 && s0 + seg(i) < s) { s0 += seg(i); i++; }
    const len = seg(i);
    const t = len > 1e-12 ? Math.min(1, Math.max(0, (s - s0) / len)) : 0;
    out.push([src[i][0] + (src[i + 1][0] - src[i][0]) * t, src[i][1] + (src[i + 1][1] - src[i][1]) * t]);
  }
  return out;
}

/**
 * Each point moved `by` to the right of the line (into the overhang) -- or, where the
 * overhang is narrower than twice that before another of its free `edges` (the ring of an
 * eyelet round its hole), to the middle of it, so the hoop's top stays under the ring.
 */
function inset(line, by, edges = []) {
  const others = edges.flatMap((e) => resampled(e.pts, 0.25, e.closed));
  return line.map((p, i) => {
    const a = line[Math.max(0, i - 1)], b = line[Math.min(line.length - 1, i + 1)];
    const tx = b[0] - a[0], ty = b[1] - a[1], tn = Math.hypot(tx, ty) || 1;
    const mx = ty / tn, my = -tx / tn;   // into the overhang
    let d = by;
    for (const q of others) {
      const ahead = (q[0] - p[0]) * mx + (q[1] - p[1]) * my;
      if (ahead > 0.05 && ahead / 2 < d && Math.abs((q[0] - p[0]) * my - (q[1] - p[1]) * mx) < 0.3) d = ahead / 2;
    }
    return [p[0] + mx * d, p[1] + my * d];
  });
}
