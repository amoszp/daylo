// Builds the iCalendar feed (RFC 5545) that the phone's calendar subscribes to.
// Work days become timed events in Canary Islands time; days off and holidays
// become all-day events that don't block time.

export const DEFAULT_TIMES = {
  early: { s: '08:00', e: '17:00' },
  mid: { s: '11:30', e: '20:30' },
  late: { s: '15:00', e: '00:00' },
  train: { s: '09:00', e: '18:00' },
};
export const NAMES = { early: 'Temprano', mid: 'Intermedio', late: 'Tarde', train: 'Formación', off: 'Libre', hol: 'Festivo', other: 'Otro turno' };
const VIA = { car: 'en coche', bus: 'en guagua' };
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const TIMEZONE = [
  'BEGIN:VTIMEZONE', 'TZID:Atlantic/Canary',
  'BEGIN:STANDARD', 'DTSTART:19701025T020000', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'TZNAME:WET', 'END:STANDARD',
  'BEGIN:DAYLIGHT', 'DTSTART:19700329T010000', 'TZOFFSETFROM:+0000', 'TZOFFSETTO:+0100', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'TZNAME:WEST', 'END:DAYLIGHT',
  'END:VTIMEZONE',
];

const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const compact = (iso) => iso.replace(/-/g, '');
function nextDay(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + 1));
  return t.toISOString().slice(0, 10);
}
function stamp(now) { return now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); }

/** Lines longer than 75 octets are folded, as the standard asks. */
function fold(line) {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const parts = [];
  let start = 0, limit = 75;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--; // never split a character
    parts.push(bytes.subarray(start, end).toString('utf8'));
    start = end; limit = 74;
  }
  return parts.join('\r\n ');
}

/** The start and end of a work day, from the day itself ("other"), the user's times, or the defaults. */
export function timesFor(day, tipos) {
  if (day.t === 'other') return TIME_RE.test(day.s) && TIME_RE.test(day.e) ? { s: day.s, e: day.e } : null;
  const own = tipos.find((t) => t.id === day.t);
  const def = DEFAULT_TIMES[day.t];
  if (!def) return null;
  return { s: own && TIME_RE.test(own.s) ? own.s : def.s, e: own && TIME_RE.test(own.e) ? own.e : def.e };
}

export function buildIcs(items, { now = new Date(), name = 'Turnos' } = {}) {
  const tipos = items.tipo || [];
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Daylo//Turnos//ES', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(name)}`, 'X-WR-TIMEZONE:Atlantic/Canary', 'REFRESH-INTERVAL;VALUE=DURATION:PT6H', 'X-PUBLISHED-TTL:PT6H', ...TIMEZONE];
  const days = (items.dia || []).filter((d) => DATE_RE.test(d.id) && NAMES[d.t]).sort((a, b) => a.id.localeCompare(b.id));
  for (const d of days) {
    const ev = ['BEGIN:VEVENT', `UID:${d.id}@daylo`, `DTSTAMP:${stamp(now)}`];
    if (d.t === 'off' || d.t === 'hol') {
      ev.push(`DTSTART;VALUE=DATE:${compact(d.id)}`, `DTEND;VALUE=DATE:${compact(nextDay(d.id))}`, `SUMMARY:${esc(NAMES[d.t])}`, 'TRANSP:TRANSPARENT');
    } else {
      const t = timesFor(d, tipos);
      if (!t) continue;
      const endDate = t.e <= t.s ? nextDay(d.id) : d.id; // a shift ending at 00:00 ends the next day
      const office = d.loc === 'office';
      const summary = `${NAMES[d.t]}${office ? ` · Oficina${d.via ? ` ${VIA[d.via] || ''}` : ''}` : ''}`.trim();
      ev.push(`DTSTART;TZID=Atlantic/Canary:${compact(d.id)}T${t.s.replace(':', '')}00`,
        `DTEND;TZID=Atlantic/Canary:${compact(endDate)}T${t.e.replace(':', '')}00`,
        `SUMMARY:${esc(summary)}`, 'TRANSP:OPAQUE');
    }
    ev.push('END:VEVENT');
    lines.push(...ev);
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
