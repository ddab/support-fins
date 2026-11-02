/**
 * Draw's paint bucket: click a red overhang and it fills with the support picked --
 * Line, Curve, Gusset or Hoop. Auto stands its supports under that one overhang
 * (the analysis cut down to it), and each comes back as the clicks that would draw
 * it by hand: ordinary drawn supports, selected, removed, undone and saved like any
 * other, and re-stood when the part turns.
 *
 *   Line    Auto's walls, each as straight pieces (a wall that bends is cut where it
 *           strays more than BUCKET.tol from a straight line)
 *   Curve   Auto with Curved walls: a bent wall as arcs (three clicks each), the
 *           straight ones as lines
 *   Gusset  Auto's gussets with no walls (fins/gussets.js): each one's side, side
 *           point and reach
 *   Hoop    the same with hoops only
 *
 * Every wall is tried as drawn (draw.js drawnWall) before it is kept, so the bucket
 * never lists one the rebuild would refuse.
 */
import { buildFins } from '../fins.js';
import { drawnWall } from '../draw.js';
import { arcThrough, DRAW_MIN_RADIUS } from '../drawarc.js';
import { PROP } from '../prop.js';
import { classify, HOLE, MUST } from './coverage.js';
import { seatedPartTris } from './seating.js';

export const BUCKET = {
  tol: 1,        // mm: a piece strays no further than this from the wall it stands for
  minLen: 2.5,   // mm: a piece shorter than this is left out (draw.js wants 2)
};

/** The overhang (one of analyze's regions) face `f` is in, or null. */
export function regionOf(result, f) {
  return result.regions.find((g) => g.faces.includes(f)) ?? null;
}

/** `result` with just `region` red: the rest of the part is left as if it held itself.
 *  A small bore Auto leaves bare on purpose (coverage.js HOLE) is filled all the same:
 *  it was clicked. */
function onlyRegion(topo, result, region, rot) {
  const over = new Uint8Array(topo.nFaces), kept = new Uint8Array(topo.nFaces);
  const cls = classify(topo, result, rot), coverageClasses = new Uint8Array(topo.nFaces);
  for (const f of region.faces) {
    over[f] = kept[f] = 1;
    coverageClasses[f] = cls[f] === HOLE ? MUST : cls[f];
  }
  return { ...result, over, kept, coverageClasses, regions: [region], overArea: region.area, overFaceCount: region.faces.length };
}

const SHAPES = {
  line: {},
  curve: { curvedWalls: true },
  gusset: { autoGussets: true, straightWalls: false },
  hoop: { autoHoops: true, straightWalls: false },
};

/**
 * Fill the overhang face `face` is in with `shape`. `opts`: the page's build options
 * (Auto's: tines, coverage, layer height, tunables...). Returns { ok, region, walls,
 * why }: each wall in print space, as Draw stores it before it goes to the part's
 * frame -- { a, b } a line, { a, b, m } a curve, { kind: 'gusset', hoop?, n, a, b }
 * a gusset or hoop (n: the side's normal, the part's own frame).
 */
export function bucketFill(topo, result, rot, face, shape, opts = {}) {
  const region = regionOf(result, face);
  if (!region) return { ok: false, why: 'click a red overhang' };
  const built = buildFins(topo, onlyRegion(topo, result, region, rot), rot, {
    ...opts, ...SHAPES[shape], mode: 'auto', sway: undefined, bedPad: false, tallRibs: false, islands: undefined,
  });
  const tris = seatedPartTris(topo, rot, result.offset);
  const check = { topo, rot, offset: result.offset };
  const walls = [];
  for (const f of built.fins ?? []) {
    if (f.kind === 'gusset') {
      if ((shape === 'hoop') === !!f.hoop && f.at) {
        walls.push({ kind: 'gusset', ...(f.hoop ? { hoop: true } : {}), n: f.at.n, a: f.at.w, b: f.at.o });
      }
      continue;
    }
    if (shape === 'gusset' || shape === 'hoop' || (f.kind !== 'prop' && f.kind !== 'wedge')) continue;
    const line = (f.line ?? []).map((p) => [p[0], p[1], p[2] + PROP.gap]);
    for (const w of pieces(line, shape === 'curve')) {
      const r = drawnWall(w.a, w.b, tris, 0, { ...check, ...(w.m ? { through: w.m } : {}) });
      if (r.ok) walls.push(w);
      else if (w.m && drawnWall(w.a, w.b, tris, 0, check).ok) walls.push({ a: w.a, b: w.b });
    }
  }
  return walls.length
    ? { ok: true, region, walls }
    : { ok: false, region, why: shape === 'hoop' ? 'no hoop fits that overhang — a hoop needs a hole or an edge to follow back to a side'
                         : shape === 'gusset' ? 'no gusset fits that overhang — there is no upright side under it'
                         : 'no wall fits under that overhang' };
}

const plan = (p, q) => Math.hypot(q[0] - p[0], q[1] - p[1]);

/** Does the stretch line[i..j] stay within BUCKET.tol of one straight piece (or arc)? */
function fits(line, i, j, arcs) {
  const a = line[i], b = line[j], m = line[(i + j) >> 1];
  const c = arcs && j - i >= 2 ? arcThrough(a, b, m) : null;
  if (c && c.r < DRAW_MIN_RADIUS) return false;
  for (let k = i + 1; k < j; k++) {
    const p = line[k];
    let d;
    if (c) d = Math.abs(Math.hypot(p[0] - c.cx, p[1] - c.cy) - c.r);
    else {
      const L = plan(a, b) || 1;
      d = Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / L;
    }
    if (d > BUCKET.tol) return false;
  }
  return true;
}

/** A wall's top line as the pieces Draw lays: as few as fit, each { a, b } or { a, b, m }. */
export function pieces(line, arcs) {
  const out = [];
  let i = 0;
  while (i < line.length - 1) {
    let j = i + 1;
    while (j + 1 < line.length && fits(line, i, j + 1, arcs)) j++;
    const a = line[i], b = line[j];
    if (plan(a, b) >= BUCKET.minLen) {
      const m = line[(i + j) >> 1];
      const c = arcs && j - i >= 2 ? arcThrough(a, b, m) : null;
      // a bend too slight to see is the straight wall
      const sag = c ? c.r - Math.sqrt(Math.max(0, c.r * c.r - (plan(a, b) / 2) ** 2)) : 0;
      out.push(sag > BUCKET.tol / 2 ? { a, b, m } : { a, b });
    }
    i = j;
  }
  return out;
}
