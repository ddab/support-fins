/**
 * GUSSET HOOPS -- a gusset that follows an overhang's EDGE instead of running straight
 * out: off the side, out along one edge of the overhang, round its end and back to the
 * side, leaving the middle open (a tab with a screw hole in it keeps its hole clean).
 *
 *        side                    plan, from above
 *   ██████████████
 *   ██    ╭──────────╮          ── the hoop, just inside the overhang's edge
 *   ██≡  ╱  ╭────╮   │          ≡  side tines at BOTH ends
 *   ██   │  │ () │   │          () a hole the hoop leaves open
 *   ██≡  ╲  ╰────╯   │
 *   ██    ╰──────────╯
 *
 * A gusset in every other way (gusset.js): its top is the tip under the overhang, its
 * ends stand off the side and are tined to it, it keeps clear of the part and the other
 * supports the same way. Its underside climbs at GUSSET.angle ALONG the hoop from each
 * end, so every layer of its bottom edge sits on the one below -- deepest where it meets
 * the side, GUSSET.endDepth under the overhang half way round.
 *
 * Placement is by hand (Draw > Hoop): a click on the side, then a click on the overhang.
 * The edge is the overhang's own outline: its down-facing faces, grown from the one
 * under the second click, and the outer boundary of that patch from where it leaves the
 * side to where it comes back.
 */
import { solidClearance } from './inside.js';
import { PROP, emitTines, tineStepFor, crestOn, crestPart } from './prop.js';
import { clearBetween, trimmedEnds } from './prop/attached.js';
import { welds } from './prop/clearance.js';
import { sweepBetween } from './prop/sweep.js';
import { GUSSET, gussetDir, undersideAt, sideHolds, sideTinesAt, refused, intoPart } from './gusset.js';

export const HOOP = {
  downCos: 0.5,     // a face is part of the overhang when its normal points down this much (60 deg off upright)
  onSide: 0.05,     // mm: an outline point this close to the side's plane is on the side
  edgeIn: 0.15,     // mm: the hoop's outer face stands this far inside the overhang's edge
  step: 0.5,        // mm between stations round the hoop: an edge curls tighter than a wall's 1 mm
  endSlack: 1.0,    // mm: how much further off the side clearance may trim an end before it can't be tined
  maxLength: 120,   // mm round: past this it's a fence, not a hoop
};

/**
 * The hoop off the side at `w` (print space, a point on the side `side`: its face index
 * or its normal, as gusset.js's `sideNormal`) round the edge of the overhang clicked at
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
  const dist = (p) => (p[0] - w[0]) * nx + (p[1] - w[1]) * ny;
  const angle = Math.max(GUSSET.minAngle, Number.isFinite(opts.angle) ? opts.angle : GUSSET.angle);
  const slope = Math.tan((angle * Math.PI) / 180);
  const layerH = opts.layerHeight ?? PROP.tineH;

  // The edge: the overhang's outline from the side round to the side, then moved in
  // so the hoop's outer face stands HOOP.edgeIn inside it.
  const edge = edgeFrom(topo, rot, tris, o, w[2], dist);
  if (edge.why) return edge.why === 'none'
    ? { ok: false, reason: 'no edge to follow there — click on the overhang the hoop should run round' }
    : { ok: false, reason: 'the overhang’s edge doesn’t come back to this side — use a gusset instead' };
  const d0 = PROP.sideClear + PROP.th / 2;   // its end cap's corners stand a flank off the side
  const line = clipped(inset(resampled(edge.line, HOOP.step / 2), PROP.th / 2 + HOOP.edgeIn), dist, d0);
  if (!line) return { ok: false, reason: 'no edge to follow there — click on the overhang the hoop should run round' };
  const pts = resampled(line, HOOP.step);
  const length = arcLength(pts);
  let reach = 0;
  for (const p of pts) reach = Math.max(reach, dist(p));
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
    if (z === null) return { ok: false, reason: 'nothing overhangs there — the gusset has to run out under the overhang' };
    top.push([x, y, z]);
  }

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
  const ends = [0, top.length - 1];
  if (ends.some((k) => dist(top[k]) > d0 + HOOP.endSlack)) return intoPart();
  for (let k = 1; k < top.length - 1; k++) {
    if (!clearBetween(top, floors, k, topo, rot, offset)) return intoPart();
  }

  // The side behind BOTH ends, all the way down each
  const edges = ends.map((k) => ({ k, u: dist(top[k]), zLo: floors[k][2] + PROP.footGap, zHi: top[k][2] - PROP.gap }));
  for (const e of edges) {
    const back = e.u + GUSSET.wallProbe;
    if (!sideHolds(topo, rot, offset, [top[e.k][0] - nx * back, top[e.k][1] - ny * back], e.zLo, e.zHi, layerH)) {
      return refused('the side doesn’t run far enough down for a gusset this long at {angle}° — reach less far, or start it lower on the side',
                     { angle });
    }
  }

  const out = [];
  if (crestOn()) crestPart(tris, layerH);
  if (!sweepBetween(top, floors, out, PROP.minHeightSquat)) {
    return { ok: false, reason: 'too little room under the overhang there for a gusset' };
  }
  const hit = solidClearance(topo, rot, offset, out, 0.25);
  if (hit && welds(hit)) return intoPart();
  let height = 0;
  for (let k = 0; k < top.length; k++) height = Math.max(height, top[k][2] - PROP.gap - floors[k][2]);

  let sideTines = 0;
  for (const e of edges) sideTines += sideTinesAt(topo, rot, offset, top[e.k], dir, e.u, e.zLo, e.zHi, layerH, out);
  const tines = opts.tines
    ? emitTines(top, tris, topo, rot, offset, out, tineStepFor(opts.tineDensity ?? 1), undefined, layerH)
    : 0;
  if (opts.supports?.hits(out, PROP.sideClear)) {
    return { ok: false, reason: 'the gusset would fuse with a support already standing there — place it clear of that support' };
  }
  return { ok: true, hoop: true, tris: out, reach, length: arcLength(top), height, angle, tines, sideTines,
           top, floors: floors.map((f) => f[2]) };
}

/**
 * The overhang's edge from the side round to the side, as a plan polyline
 * ([x, y] points) with the overhang on its LEFT: { line } or { why: 'none' | 'side' }.
 *
 * The overhang is the patch of down-facing faces (HOOP.downCos) grown across the mesh
 * from the one under `o` -- the lowest above `zMin`, as undersideAt finds it. Its
 * boundary edges (used by one face of the patch) close into loops: the outer one is the
 * edge, the rest are holes. The stretch of it lying on the side (`dist` < HOOP.onSide)
 * is where the overhang meets the side; what's left between two such stretches is a
 * run from the side round to the side, and the one nearest the click is the hoop's.
 */
export function edgeFrom(topo, rot, tris, o, zMin, dist) {
  const seed = seedFace(topo, rot, tris, o, zMin);
  if (seed < 0) return { why: 'none' };
  const patch = grow(topo, rot, seed);

  // boundary edges, as the faces wind them; a corner's print-space point by welded id
  const { vid } = topo;
  const at = new Map(), uses = new Map();
  const key = (a, b) => (a < b ? `${a},${b}` : `${b},${a}`);
  for (const f of patch) {
    for (let i = 0; i < 3; i++) {
      const a = vid[f * 3 + i], b = vid[f * 3 + ((i + 1) % 3)];
      if (!at.has(a)) at.set(a, [tris[f * 9 + i * 3], tris[f * 9 + i * 3 + 1]]);
      const k = key(a, b);
      uses.set(k, uses.has(k) ? null : [a, b]);
    }
  }
  const next = new Map();
  for (const e of uses.values()) if (e) next.set(e[0], e[1]);

  // ...closed into loops; the outer one has the most area
  let outer = null, best = 0;
  const seen = new Set();
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const loop = [];
    for (let v = start; v !== undefined && !seen.has(v); v = next.get(v)) { seen.add(v); loop.push(at.get(v)); }
    const a = Math.abs(signedArea(loop));
    if (loop.length >= 3 && a > best) { best = a; outer = loop; }
  }
  if (!outer) return { why: 'none' };
  if (signedArea(outer) < 0) outer.reverse();   // counter-clockwise: the overhang on the left

  // the runs between the stretches on the side
  const onSide = outer.map((p) => dist(p) < HOOP.onSide);
  const first = onSide.indexOf(true);
  if (first < 0) return { why: 'side' };
  const N = outer.length, runs = [];
  let run = null;
  for (let i = 1; i <= N; i++) {
    const j = (first + i) % N;
    if (!onSide[j]) {
      run ??= [outer[(j - 1 + N) % N]];
      run.push(outer[j]);
    } else if (run) {
      run.push(outer[j]);
      runs.push(run);
      run = null;
    }
  }
  if (!runs.length) return { why: 'side' };
  let pick = runs[0], dBest = Infinity;
  for (const r of runs) {
    for (const p of r) {
      const d = Math.hypot(p[0] - o[0], p[1] - o[1]);
      if (d < dBest) { dBest = d; pick = r; }
    }
  }
  return { line: pick };
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

function signedArea(loop) {
  let a = 0;
  for (let i = 0; i < loop.length; i++) {
    const p = loop[i], q = loop[(i + 1) % loop.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

function arcLength(line) {
  let s = 0;
  for (let i = 1; i < line.length; i++) s += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
  return s;
}

/** `line` re-cut into equal steps of at most `step`, its ends kept. */
function resampled(line, step) {
  const L = arcLength(line);
  const n = Math.max(1, Math.ceil(L / step));
  const out = [];
  let i = 0, s0 = 0;
  for (let k = 0; k <= n; k++) {
    const s = (L * k) / n;
    while (i < line.length - 2 && s0 + Math.hypot(line[i + 1][0] - line[i][0], line[i + 1][1] - line[i][1]) < s) {
      s0 += Math.hypot(line[i + 1][0] - line[i][0], line[i + 1][1] - line[i][1]);
      i++;
    }
    const seg = Math.hypot(line[i + 1][0] - line[i][0], line[i + 1][1] - line[i][1]);
    const t = seg > 1e-12 ? Math.min(1, Math.max(0, (s - s0) / seg)) : 0;
    out.push([line[i][0] + (line[i + 1][0] - line[i][0]) * t, line[i][1] + (line[i + 1][1] - line[i][1]) * t]);
  }
  return out;
}

/** Each point moved `by` to the left of the line (into the overhang). */
function inset(line, by) {
  return line.map((p, i) => {
    const a = line[Math.max(0, i - 1)], b = line[Math.min(line.length - 1, i + 1)];
    const tx = b[0] - a[0], ty = b[1] - a[1], tn = Math.hypot(tx, ty) || 1;
    return [p[0] - (ty / tn) * by, p[1] + (tx / tn) * by];
  });
}

/** The part of `line` at least `d0` off the side, cut exactly there at both ends; null
 *  when none of it is. */
function clipped(line, dist, d0) {
  let a = line.findIndex((p) => dist(p) >= d0);
  let b = line.length - 1 - [...line].reverse().findIndex((p) => dist(p) >= d0);
  if (a < 0 || b <= a) return null;
  const cut = (p, q) => {
    const dp = dist(p), dq = dist(q), t = (d0 - dp) / (dq - dp);
    return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  };
  const out = line.slice(a, b + 1);
  if (a > 0) out.unshift(cut(line[a - 1], line[a]));
  if (b < line.length - 1) out.push(cut(line[b + 1], line[b]));
  return out;
}
