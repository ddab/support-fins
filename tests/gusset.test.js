// Gussets (web/gusset.js): a hand-placed fin that stands off a SIDE of the part, not
// the plate. These pin, on an upside-down L: a gusset off the upright builds under the
// arm, never reaches the plate, is watertight, tines into the side and the overhang
// only with Tines on, keeps its underside at least 45 deg, and refuses a start that
// isn't a side and a reach past its limits.

import { WEB, buildTopology, isClosed, insideCount, assert, assertClose } from './_util.js';

const { gussetAt, gussetDir, GUSSET } = await import(`${WEB}gusset.js`);
const { PROP } = await import(`${WEB}prop.js`);
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const OFF = { x: 0, y: 0, z: 0 };

// The L in XZ, extruded 20 mm along Y: a 5 mm upright 30 mm tall, its 25 mm arm 5 mm
// thick on top. The face at x = 5 under the arm is the side a gusset stands off.
const L = [[0, 0], [5, 0], [5, 30], [25, 30], [25, 35], [0, 35]];
const DEPTH = 20;

function lTopo(poly = L) {
  const t = [];
  const P = (x, y, z) => [x, y, z];
  // caps: a fan from the last vertex (the L is fan-able from its top-left corner)
  const f = poly.length - 1;
  for (let i = 0; i < f - 1; i++) {
    const [a, b, c] = [poly[f], poly[i], poly[i + 1]];
    t.push(P(a[0], 0, a[1]), P(c[0], 0, c[1]), P(b[0], 0, b[1]));
    t.push(P(a[0], DEPTH, a[1]), P(b[0], DEPTH, b[1]), P(c[0], DEPTH, c[1]));
  }
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    t.push(P(a[0], 0, a[1]), P(b[0], 0, b[1]), P(b[0], DEPTH, b[1]));
    t.push(P(a[0], 0, a[1]), P(b[0], DEPTH, b[1]), P(a[0], DEPTH, a[1]));
  }
  // wind outward: flip all if the volume came out negative
  let V = 0;
  for (let i = 0; i < t.length; i += 3) {
    const [a, b, c] = [t[i], t[i + 1], t[i + 2]];
    V += a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
  }
  if (V < 0) for (let i = 0; i < t.length; i += 3) [t[i + 1], t[i + 2]] = [t[i + 2], t[i + 1]];
  const pos = new Float32Array(t.length * 3);
  t.forEach((p, i) => pos.set(p, i * 3));
  return buildTopology({ getAttribute: (k) => (k === 'position' ? { array: pos } : null) });
}

/** The face whose (unrotated) normal is closest to (nx, 0, 0) and that contains x = x0. */
function faceAt(topo, x0, nx) {
  for (let f = 0; f < topo.nFaces; f++) {
    const o = f * 9;
    if (Math.abs(topo.nrm[f * 3] - nx) > 1e-3) continue;
    if ([0, 3, 6].every((k) => Math.abs(topo.pos[o + k] - x0) < 1e-4)) return f;
  }
  return -1;
}

function build(opts = {}, w = [5, 10, 20], o = [15, 10, 30]) {
  const topo = lTopo();
  const face = faceAt(topo, 5, 1);
  assert(face >= 0, 'test setup: no face on the upright at x = 5');
  const r = gussetAt(w, o, face, topo.pos, { topo, rot: IDENTITY, offset: OFF, ...opts });
  return { topo, face, r };
}

const zs = (tris) => tris.map((v) => v[2]);

Deno.test('gusset: off the L’s upright, it builds under the arm and runs square off the side', () => {
  const { topo, face, r } = build();
  assert(r.ok, `gusset failed: ${r.reason}`);
  assert(r.tris.length > 0, 'gusset produced no geometry');
  const d = gussetDir(topo, IDENTITY, face);
  assertClose(d[0], 1, 1e-6, 'runs along the side’s normal');
  assertClose(r.reach, 10, 1e-6, 'reach is the second click, measured out from the side');
  // the whole fin sits in x 5..15 (+ its tip), y about the click, under the arm
  const xs = r.tris.map((v) => v[0]);
  assert(Math.min(...xs) > 5 - 0.01 && Math.max(...xs) < 15 + 0.6, `fin spills out of 5..15: ${Math.min(...xs)}..${Math.max(...xs)}`);
  assert(Math.max(...zs(r.tris)) <= 30 - PROP.gap + 1e-6, 'fin pokes up into the arm');
});

Deno.test('gusset: never reaches the plate — its lowest point is up the side', () => {
  const { r } = build();
  assert(r.ok, r.reason);
  const low = Math.min(...zs(r.tris));
  // 10 mm out at 50 deg climbs ~11.9 mm to the end's 2 mm: the inner end sits ~16 mm up
  assert(low > 10, `fin reaches down to z ${low.toFixed(2)}`);
  assert(r.floors.every((z) => z > 0), 'a station stood on the plate');
});

Deno.test('gusset: its underside climbs at the angle asked, never flatter than 45 deg', () => {
  for (const angle of [50, 60, 30]) {
    const { r } = build({ angle });
    assert(r.ok, `${angle} deg: ${r.reason}`);
    const f = r.floors, du = r.reach - PROP.gap;
    const got = (Math.atan((f[f.length - 1] - f[0]) / du) * 180) / Math.PI;
    assertClose(got, Math.max(angle, GUSSET.minAngle), 0.01, `underside slope at ${angle} deg`);
  }
});

Deno.test('gusset: watertight, plain and tined', () => {
  for (const tines of [false, true]) {
    const { r } = build({ tines });
    assert(r.ok, r.reason);
    // tines are separate closed solids the slicer unions; each piece must close
    assert(isClosed(r.tris), `gusset (tines ${tines}) is not closed`);
  }
});

// The top comb is emitTines', which leaves a FLAT underside to the gap contact (a
// drawn wall under this arm gets none either), so only the side tines are pinned.
Deno.test('gusset: Tines ON grips the side, OFF is a plain breakaway fin', () => {
  const on = build({ tines: true, tineDensity: 1, layerHeight: 0.2 }).r;
  const off = build({ tines: false }).r;
  assert(on.ok && off.ok, 'gusset failed to build');
  assert(on.sideTines >= 3, `too few tines into the side (${on.sideTines})`);
  assert(!off.sideTines && !off.tines, 'Tines off still emitted tines');
  // every side tine sits in one layer cell and reaches past the gap into the side
  const extra = on.tris.slice(off.tris.length);
  assert(extra.some((v) => v[0] < 5), 'no tine reaches the side at x = 5');
});

Deno.test('gusset: only tines bite into the part, never the body', () => {
  const { topo, r } = build({ tines: false });
  assert(r.ok, r.reason);
  assert(insideCount(topo, IDENTITY, OFF, r.tris) === 0, 'the plain body has vertices inside the part');
});

Deno.test('gusset: refused off a face that isn’t a side, and past its reach limits', () => {
  const topo = lTopo();
  const opts = { topo, rot: IDENTITY, offset: OFF };
  // the arm's underside (normal -z) is a roof, not a side
  let under = -1;
  for (let f = 0; f < topo.nFaces; f++) if (topo.nrm[f * 3 + 2] < -0.99 && topo.pos[f * 9 + 2] > 29) { under = f; break; }
  assert(under >= 0, 'test setup: no underside face');
  assert(!gussetAt([10, 10, 30], [15, 10, 30], under, topo.pos, opts).ok, 'built off the underside');
  const side = faceAt(topo, 5, 1);
  const short = gussetAt([5, 10, 20], [6, 10, 30], side, topo.pos, opts);
  assert(!short.ok && /too short/.test(short.reason), `a 1 mm gusset: ${short.reason}`);
  const past = gussetAt([5, 10, 20], [27, 10, 30], side, topo.pos, opts);
  assert(!past.ok, 'built out past the end of the arm');
});

Deno.test('gusset: follows the part when it turns (the pose is rot + offset, not baked in)', () => {
  const topo = lTopo();
  const side = faceAt(topo, 5, 1);
  // 90 deg about Z (column-major, as rotM3.elements): x -> y, y -> -x; then shifted
  const rot = [0, 1, 0, -1, 0, 0, 0, 0, 1], off = { x: 40, y: -7, z: 0 };
  const pose = ([x, y, z]) => [-y + off.x, x + off.y, z + off.z];
  const tris = new Float64Array(topo.pos.length);
  for (let i = 0; i < tris.length; i += 3) tris.set(pose([topo.pos[i], topo.pos[i + 1], topo.pos[i + 2]]), i);
  const flat = gussetAt([5, 10, 20], [15, 10, 30], side, topo.pos, { topo, rot: IDENTITY, offset: OFF });
  const r = gussetAt(pose([5, 10, 20]), pose([15, 10, 30]), side, tris, { topo, rot, offset: off });
  assert(r.ok, `turned gusset failed: ${r.reason}`);
  assertClose(r.reach, flat.reach, 1e-6, 'reach');
  assertClose(r.height, flat.height, 1e-6, 'height');
  assert(r.tris.length === flat.tris.length, `turned gusset has ${r.tris.length} vertices, flat ${flat.tris.length}`);
  assert(insideCount(topo, rot, off, r.tris) === 0, 'the turned body has vertices inside the part');
});

Deno.test('gusset: refused where the side stops short of the fin’s underside', () => {
  // the upright only runs 6 mm under the arm (a short boss hanging off it): a 15 mm
  // fin at 50 deg needs ~18 mm of side
  const boss = [[0, 24], [5, 24], [5, 30], [25, 30], [25, 35], [0, 35]];
  const topo = lTopo(boss);
  const side = faceAt(topo, 5, 1);
  const r = gussetAt([5, 10, 27], [20, 10, 30], side, topo.pos, { topo, rot: IDENTITY, offset: OFF });
  assert(!r.ok && /side doesn’t run far enough/.test(r.reason), `short side: ${r.reason}`);
  // ...and a short fin there fits
  const ok = gussetAt([5, 10, 27], [8, 10, 30], side, topo.pos, { topo, rot: IDENTITY, offset: OFF });
  assert(ok.ok, `3 mm fin on the boss: ${ok.reason}`);
});
