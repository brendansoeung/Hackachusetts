// Date helpers. All plan dates are plain 'YYYY-MM-DD' strings so they
// survive JSON backups and never shift with time zones or daylight saving.

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True if the value is a real calendar date in 'YYYY-MM-DD' form. */
export function isDateStr(value) {
  if (typeof value !== 'string') return false;
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** Converts 'YYYY-MM-DD' to a UTC timestamp (ms). Throws on bad input. */
export function parseDateStr(value) {
  if (!isDateStr(value)) throw new TypeError(`Invalid date: ${value}`);
  const [y, mo, d] = value.split('-').map(Number);
  return Date.UTC(y, mo - 1, d);
}

/** Today's date on the user's device, as 'YYYY-MM-DD'. */
export function todayStr(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Adds (or subtracts) whole days to a date string. */
export function addDays(dateStr, days) {
  const dt = new Date(parseDateStr(dateStr) + days * DAY_MS);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Whole days from date a to date b (positive when b is later). */
export function daysBetween(a, b) {
  return Math.round((parseDateStr(b) - parseDateStr(a)) / DAY_MS);
}

/** Short label like "Sat, Oct 24". */
export function formatDate(dateStr) {
  const dt = new Date(parseDateStr(dateStr));
  return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}
