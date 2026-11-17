// Reads the monthly roster as the company sends it: one entry per day, in order.
// "Support"/"Onboarding" start a working day; the first time range after it is the
// local (Canary) time and any other range, or one in brackets, is ignored.
// "DAY OFF" and "PUBLIC HOLIDAY" are one day each; "1st Dec:"-style headings are skipped.

const RANGE_RE = /(\d{1,2}:\d{2})\s*[-–—]\s*(\d{1,2}:\d{2})/;
const HEADING_RE = /^\d{1,2}(st|nd|rd|th)?\b[^:]*:$/;
const pad = (t) => t.padStart(5, '0');

/**
 * @param {string} text  the pasted roster
 * @param {Record<string,{s:string,e:string}>} times  the user's times for early, mid, late
 * @returns {{t:string, s?:string, e?:string}[]}  one entry per day
 */
export function parseRoster(text, times) {
  const items = [];
  let cur = null;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const l = line.toLowerCase();
    if (HEADING_RE.test(l)) continue;
    if (l.startsWith('day off') || l.startsWith('libre') || l.startsWith('descanso')) { items.push({ kw: 'off' }); cur = null; continue; }
    if (l.startsWith('public holiday') || l.startsWith('festivo') || l.startsWith('bank holiday')) { items.push({ kw: 'hol' }); cur = null; continue; }
    if (l.startsWith('onboarding') || l.startsWith('training') || l.startsWith('formación') || l.startsWith('formacion')) { cur = { kw: 'train', range: null }; items.push(cur); }
    else if (l.startsWith('support') || l.startsWith('shift')) { cur = { kw: 'work', range: null }; items.push(cur); }
    if (cur && !cur.range) {
      const m = line.replace(/\(.*?\)/g, '').match(RANGE_RE);
      if (m) cur.range = [pad(m[1]), pad(m[2])];
    }
  }
  return items.map((it) => {
    if (it.kw === 'off' || it.kw === 'hol') return { t: it.kw };
    if (it.kw === 'train') return { t: 'train' };
    const r = it.range;
    const hit = r && ['early', 'mid', 'late'].find((k) => times?.[k]?.s === r[0] && times?.[k]?.e === r[1]);
    return hit ? { t: hit } : { t: 'other', s: r ? r[0] : '', e: r ? r[1] : '' };
  });
}
