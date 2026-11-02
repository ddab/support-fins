// Every string the Draw paint bucket and the Section view's axis and slider show
// (web/fins/bucket.js's refusals, ui/walls.js's hint and messages, index.html's button
// and titles) is translated in every locale, its {placeholders} kept. Each key is
// checked against the source too, so a reworded string can't leave a stale key behind.
import { assert } from 'jsr:@std/assert';

const KEYS = {
  'web/fins/bucket.js': [
    'click a red overhang',
    'no hoop fits that overhang — a hoop needs a hole or an edge to follow back to a side',
    'no gusset fits that overhang — there is no upright side under it',
    'no wall fits under that overhang',
  ],
  'web/ui/walls.js': [
    'couldn’t fill there: {reason}',
    'filling the overhang…',
    'filled the overhang with {n} support',
    'filled the overhang with {n} supports',
    'Hover a red overhang to light it, then click to fill all of it with the shape picked above — every one that fits, as Auto would place them. Each is a drawn support: click one to select it and remove it. Undo takes back the whole fill.',
  ],
  'web/index.html': [
    'Fill an overhang',
    'Paint bucket: click a red overhang to fill all of it with the shape picked above. Click again to place one at a time.',
    'Cut across',
    'Cut square to the X axis (left–right), keeping the half away from you.',
    'Cut square to the Y axis (front–back), keeping the half away from you.',
    'Cut square to the Z axis (up–down), keeping the half away from you.',
    'Where the cut is: drag to slide it from one end of the part to the other (Shift + scroll also works).',
  ],
};

const placeholders = (s) => [...s.matchAll(/{\w+}/g)].map((m) => m[0]).sort().join();
// a source string may be split over lines with ' + ': compare with that glue taken out
const glued = (src) => src.replace(/'\s*\+\s*'/g, '');

Deno.test('bucket and section strings: in the source, and translated in every locale with their placeholders', async () => {
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
