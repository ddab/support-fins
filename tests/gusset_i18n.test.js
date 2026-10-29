// Every string a gusset shows (web/gusset.js's refusals, the Draw button, hint and
// readout lines) is translated in every locale, its {placeholders} kept. Each key is
// checked against the source too, so a reworded string can't leave a stale key behind.
import { assert } from 'jsr:@std/assert';

const KEYS = {
  'web/gusset.js': [
    'start a gusset on a side of the part — an upright face under the overhang',
    'gusset too short — reaches {reach}mm out from the side, needs {min}mm',
    'gusset too long — {reach}mm out from the side, at most {max}mm; stand a wall on the plate instead',
    'nothing overhangs there — the gusset has to run out under the overhang',
    'the side doesn’t run far enough down for a gusset this long at {angle}° — reach less far, or start it lower on the side',
    'the gusset runs into the part — start it where the side is flat and clear out to the overhang',
    'too little room under the overhang there for a gusset',
  ],
  'web/index.html': [
    'Gusset',
    'A fin off a side of the part, up under an overhang: click the side, then the overhang',
  ],
  'web/ui/walls.js': [
    'Click a side of the part under an overhang, then the point on the overhang the gusset should reach out to. It runs square off the side, its underside climbing at {angle}° so nothing under it touches the plate. Backspace takes back the side; Esc or right-click cancels.',
    'can’t place this gusset: {reason}',
    'couldn’t start a gusset there: {reason}',
    'gusset {mm}mm out from the side',
    '{n} side tine',
    '{n} side tines',
  ],
  'web/ui/readout.js': [
    'Click a side of the part under an overhang, then the overhang itself, to stand a gusset off the side',
    '{n} gusset',
    '{n} gussets',
    '{n} side tine',
    '{n} side tines',
  ],
};

const placeholders = (s) => [...s.matchAll(/{\w+}/g)].map((m) => m[0]).sort().join();
// a source string may be split over lines with ' + ': compare with that glue taken out
const glued = (src) => src.replace(/'\s*\+\s*'/g, '');

Deno.test('gusset strings: in the source, and translated in every locale with their placeholders', async () => {
  const dicts = {};
  for (const lang of ['de', 'nl', 'pt', 'zh', 'ar']) dicts[lang] = (await import(`../web/i18n/${lang}.js`)).default;
  for (const [file, keys] of Object.entries(KEYS)) {
    const src = glued(await Deno.readTextFile(new URL(`../${file}`, import.meta.url)));
    for (const key of keys) {
      assert(src.includes(key), `${file} no longer says: ${key}`);
      for (const [lang, dict] of Object.entries(dicts)) {
        const v = dict[key];
        assert(v && v !== key, `${lang}: missing ${key}`);
        for (const form of typeof v === 'string' ? [v] : Object.values(v)) {
          assert(placeholders(form) === placeholders(key), `${lang}: ${key} -> ${form} changed its placeholders`);
        }
      }
    }
  }
});
