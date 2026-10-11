import fs from 'fs';
import * as cheerio from 'cheerio';

const BASE_URL = 'https://classic.skagitcountywa.gov/Reporting';
export const ROSTER_URL = `${BASE_URL}/JailRoster/`;
export const RELEASES_URL = `${BASE_URL}/JailRelease/`;

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5'
};

// Per-request cap. The roster page is ~2.5 MB, so allow a bit longer.
const REQUEST_TIMEOUT_MS = 60_000;

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Retry wrapper. Backoff: 2s, 5s, 10s.
async function getWithRetry(url, attempts = 3) {
  const backoff = [2000, 5000, 10000];
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        console.error(`  Request failed (attempt ${i + 1}/${attempts}): ${err.message} — retrying in ${backoff[i] / 1000}s`);
        await delay(backoff[i]);
      }
    }
  }
  throw lastErr;
}

function clean(text) {
  return (text || '').replace(/\s+/g, ' ').trim();
}

// "$150,000.00" -> 150000. Blank, "Included" or $0 -> null.
function parseDollars(text) {
  const m = (text || '').match(/\$\s*([\d,]+\.?\d*)/);
  if (!m) return null;
  const v = parseFloat(m[1].replace(/,/g, ''));
  return v > 0 ? v : null;
}

// Skagit prints Pacific local time as "14:58:00 03/05/26" (2-digit year).
// Store "2026-03-05T14:58:00" so values sort as strings and browsers parse them.
export function toLocalIso(text) {
  const m = clean(text).match(/^(\d{2}):(\d{2}):(\d{2}) (\d{2})\/(\d{2})\/(\d{2})$/);
  if (!m) return clean(text) || null;
  const [, hh, mi, ss, mo, dd, yy] = m;
  return `20${yy}-${mo}-${dd}T${hh}:${mi}:${ss}`;
}

// "Name Number" is a per-person number (it's also the VINE offender ID), so
// a booking is identified by name number + incarceration time.
export function bookingId(nameNumber, bookedAt) {
  return `${nameNumber}-${(bookedAt || '').replace(/\D/g, '')}`;
}

// The roster and the release report share one layout: a name row
// (tr#<num>Name) followed by a hidden detail row (tr#<num>.DetailOff).
// The detail holds a summary table (incarceration date, scheduled release or
// release date, housing) and then one table per arrest: four labelled lines
// and a charges table. The release report's charges have no Disposition
// column, so charge columns are read by header name, not position.
//
// Arrest Location is deliberately not kept: it is often a street address,
// and data/ is published.
export function parseReport(html) {
  const $ = cheerio.load(html);
  const people = [];

  $('tr[id$="Name"]').each((_, row) => {
    const nameNumber = ($(row).attr('id') || '').replace(/Name$/, '');
    const [last, first, middle, suffix] = $(row).children('td').toArray().map(td => clean($(td).text()));
    if (!nameNumber || !last) return;
    const name = `${last}, ${[first, middle, suffix].filter(Boolean).join(' ')}`.replace(/, $/, '');

    const detail = $(`tr[id="${nameNumber}"]`);
    const summary = {};
    const arrests = [];
    let arrest = null;
    let columns = null;

    detail.find('tr').each((_, tr) => {
      const tds = $(tr).children('td').toArray().map(td => clean($(td).text()));
      // Summary lines: ["Incarceration Date:", "14:58:00 03/05/26", ...]
      if (/:$/.test(tds[0] || '')) {
        summary[tds[0].replace(/:$/, '').trim()] = tds[1] || '';
        return;
      }
      const label = (tds[1] || '').replace(/\s*:$/, '').trim();
      if (label === 'Arrest Date') {
        arrest = { arrestDate: toLocalIso(tds[2]), arrestType: null, agency: null, charges: [] };
        arrests.push(arrest);
        columns = null;
        return;
      }
      if (!arrest) return;
      if (label === 'Arrest Type') { arrest.arrestType = tds[2] || null; return; }
      if (label === 'Arrest Agency') { arrest.agency = tds[2] || null; return; }
      if (label === 'Arrest Location') return;
      if (label === 'Offense Date') { columns = tds; return; }
      if (columns && tds.length === columns.length && tds[2]) {
        const col = name => tds[columns.indexOf(name)] || null;
        arrest.charges.push({
          description:    col('Offense Description'),
          offenseDate:    toLocalIso(col('Offense Date')),
          incident:       col('Related Incident'),
          court:          col('Court'),
          courtReference: col('Court Reference'),
          bailAmount:     parseDollars(col('Bail Amount')),
          bailType:       col('Bail Type'),
          disposition:    columns.includes('Disposition') ? col('Disposition') : null
        });
      }
    });

    // The page doesn't list arrests in date order; the earliest one is the
    // arrest that started this booking.
    arrests.sort((a, b) => (a.arrestDate || '').localeCompare(b.arrestDate || ''));
    const bookedAt = toLocalIso(summary['Incarceration Date']);
    const charges = arrests.flatMap(a => a.charges.map(c => ({ ...c, arrestType: a.arrestType, agency: a.agency })));
    const bondTotal = charges.reduce((s, c) => s + (c.bailAmount || 0), 0);

    people.push({
      id: bookingId(nameNumber, bookedAt),
      nameNumber,
      name,
      bookedAt,
      scheduledRelease: toLocalIso(summary['Scheduled Release']) || null,
      releasedAt: toLocalIso(summary['Release date']) || null,
      location: summary['Jail Housing Location'] || null,
      arrestingAgency: arrests[0]?.agency || null,
      arrestType: arrests[0]?.arrestType || null,
      arrests: arrests.map(({ charges, ...a }) => a),
      bondTotal: bondTotal > 0 ? bondTotal : null,
      charges
    });
  });

  // "Report Run on 10/10/26 at 21:29:01"
  const run = $('body').text().match(/Report Run on (\d{2})\/(\d{2})\/(\d{2}) at (\d{2}:\d{2}:\d{2})/);
  const reportRunAt = run ? `20${run[3]}-${run[1]}-${run[2]}T${run[4]}` : null;

  return { people, reportRunAt };
}

// Set ROSTER_HTML_FILE / RELEASES_HTML_FILE to parse saved copies instead of
// fetching (handy for testing offline).
async function load(url, fileEnv) {
  return process.env[fileEnv] ? fs.readFileSync(process.env[fileEnv], 'utf-8') : getWithRetry(url);
}

export async function fetchRoster() {
  return parseReport(await load(ROSTER_URL, 'ROSTER_HTML_FILE'));
}

// The release report covers the past 48 hours and is regenerated once a day
// at 6 a.m. Non-fatal: on failure, release times fall back to "when we noticed".
export async function fetchReleaseReport() {
  try {
    return parseReport(await load(RELEASES_URL, 'RELEASES_HTML_FILE'));
  } catch (err) {
    console.error('Release report fetch failed:', err.message);
    return { people: [], reportRunAt: null };
  }
}
