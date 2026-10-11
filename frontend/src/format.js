// Timestamps are Pacific local strings: "2026-10-10T04:26:29".
// Format them by slicing the string rather than via Date, so the display
// doesn't shift if the viewer is in a different time zone.

export function formatDate(ts) {
  if (!ts) return ''
  const [y, m, d] = ts.slice(0, 10).split('-')
  return `${m}/${d}/${y.slice(2)}`
}

export function formatTime(ts) {
  if (!ts || ts.length < 16) return ''
  let h = parseInt(ts.slice(11, 13), 10)
  const min = ts.slice(14, 16)
  const ampm = h >= 12 ? 'PM' : 'AM'
  h = h % 12 || 12
  return `${h}:${min} ${ampm}`
}

export function formatDateTime(ts) {
  return ts ? `${formatDate(ts)} ${formatTime(ts)}`.trim() : ''
}

// Date-only strings ("2026-09-22") parse as UTC in JS; add a time so they
// parse as local midnight like full timestamps do.
function toDate(ts) {
  return new Date(ts.length === 10 ? `${ts}T00:00:00` : ts)
}

export function formatMoney(n) {
  if (n == null) return null
  return '$' + Number(n).toLocaleString('en-US')
}

export function timeHeld(start, end) {
  if (!start || !end) return null
  const ms = toDate(end) - toDate(start)
  if (!(ms > 0)) return null
  const totalMins = Math.floor(ms / 60000)
  const days = Math.floor(totalMins / 1440)
  const hours = Math.floor((totalMins % 1440) / 60)
  const mins = totalMins % 60
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${mins}m`
  return `${mins}m`
}

// Agencies are spelled out on the Skagit roster; only courts use codes.
export const COURT_NAMES = {
  SC:   'Superior Court',
  DC:   'District Court',
  BMC:  'Burlington Municipal Court',
  MVMC: 'Mount Vernon Municipal Court',
  AMC:  'Anacortes Municipal Court',
  SWMC: 'Sedro-Woolley Municipal Court',
  OTHR: 'Other'
}

// "MOUNT VERNON POLICE DEPT" -> "Mount Vernon Police Dept"
export function agencyName(name) {
  if (!name) return 'N/A'
  return name.toLowerCase().replace(/\b([a-z])/g, c => c.toUpperCase())
}

export function courtName(code) {
  return COURT_NAMES[code] || code
}

// "~" marks release times we estimated (first scrape they were missing)
// rather than read from the official release report.
export function releaseTime(entry, fmt) {
  return (entry.releaseSource === 'official' ? '' : '~') + fmt(entry.releasedAt)
}
