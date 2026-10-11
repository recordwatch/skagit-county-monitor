import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchRoster, fetchReleaseReport } from './scrapers/skagit.js';
import { nowLocalIso } from './utils.js';
import { buildStats } from './stats.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORAGE_DIR = path.join(__dirname, 'data');
fs.mkdirSync(STORAGE_DIR, { recursive: true });

const LOG_FILE    = path.join(STORAGE_DIR, 'change_log.json');
const STATS_FILE  = path.join(STORAGE_DIR, 'stats.json');
const STATUS_FILE = path.join(STORAGE_DIR, 'status.json');

// If the roster suddenly shrinks below this fraction of who we think is in
// custody, assume the page is broken/partial rather than mass release, and
// don't mark anyone released this run.
const MIN_ROSTER_RATIO = 0.5;

// The release report covers 48 hours and is regenerated once a day at 6 a.m.,
// so an official release time can show up ~30 hours after we notice someone
// is gone. Keep retrying the match for 3 days.
const RELEASE_MATCH_DAYS = 3;

function readJSON(file, fallback) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (e) {
    console.error(`Could not parse ${file}: ${e.message}`);
    process.exit(1); // never overwrite history with an empty array
  }
  return fallback;
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

async function run() {
  const now = nowLocalIso();
  console.log(`[${now}] Running scrape...`);

  // change_log.json is every booking we've ever seen, newest booking first.
  // Entries are updated in place (charges, housing, release).
  const log = readJSON(LOG_FILE, []);
  const isFirstRun = log.length === 0;

  let roster;
  try {
    roster = await fetchRoster();
  } catch (err) {
    console.error('Roster fetch failed:', err.message);
    process.exit(1);
  }
  const inmates = roster.people;

  const byId = new Map(log.map(e => [e.id, e]));
  const wasInCustody = log.filter(e => e.status === 'in_custody');

  if (inmates.length === 0 || (wasInCustody.length > 20 && inmates.length < wasInCustody.length * MIN_ROSTER_RATIO)) {
    console.error(`Got ${inmates.length} inmates (expected ~${wasInCustody.length}) — skipping diff to avoid false releases.`);
    process.exit(1);
  }

  const currentIds = new Set();
  let newCount = 0;

  for (const inmate of inmates) {
    if (currentIds.has(inmate.id)) continue;
    currentIds.add(inmate.id);
    const { releasedAt, ...fields } = inmate;

    const existing = byId.get(inmate.id);
    if (!existing) {
      console.log(`  NEW: ${inmate.name} (${inmate.nameNumber})`);
      const entry = {
        ...fields,
        status: 'in_custody',
        firstSeen: now,
        releasedAt: null,
        releaseSource: null,
        // true = already in jail when monitoring started, so we didn't watch
        // this booking happen. Stats use it to avoid skewed "new booking" counts.
        baseline: isFirstRun
      };
      log.push(entry);
      byId.set(entry.id, entry);
      newCount++;
      continue;
    }

    // Still in custody: refresh fields that change during a stay. Keep old
    // charges if the page shows none, so a flaky render never wipes good data.
    existing.status = 'in_custody';
    existing.releasedAt = null;
    existing.releaseSource = null;
    existing.name = inmate.name;
    existing.location = inmate.location;
    existing.scheduledRelease = inmate.scheduledRelease;
    existing.arrests = inmate.arrests.length ? inmate.arrests : existing.arrests;
    if (inmate.charges.length) {
      existing.charges = inmate.charges;
      existing.bondTotal = inmate.bondTotal;
      existing.arrestingAgency = inmate.arrestingAgency;
      existing.arrestType = inmate.arrestType;
    }
  }

  // Release times come from the release report, matched by name number +
  // incarceration time (the same id). Fall back to the scrape where they
  // went missing, and retry the match on later runs.
  const report = await fetchReleaseReport();
  const reportById = new Map(report.people.filter(p => p.releasedAt).map(p => [p.id, p]));

  let releasedCount = 0;
  for (const entry of wasInCustody) {
    if (currentIds.has(entry.id)) continue;
    const official = reportById.get(entry.id);
    console.log(`  RELEASED: ${entry.name} (${entry.nameNumber})${official ? ` at ${official.releasedAt}` : ''}`);
    entry.status = 'released';
    entry.releasedAt = official?.releasedAt || now;
    entry.releaseSource = official ? 'official' : 'observed';
    releasedCount++;
  }

  const cutoff = new Date(Date.now() - RELEASE_MATCH_DAYS * 86_400_000).toISOString().slice(0, 10);
  for (const entry of log) {
    if (entry.status !== 'released' || entry.releaseSource !== 'observed') continue;
    if ((entry.releasedAt || '') < cutoff) continue;
    const official = reportById.get(entry.id);
    if (!official) continue;
    entry.releasedAt = official.releasedAt;
    entry.releaseSource = 'official';
    console.log(`  Matched release time for ${entry.name}: ${official.releasedAt}`);
  }

  // Bookings that started and ended between two of our runs never appear on
  // the roster. The release report still lists them, so add them here.
  let reportOnlyCount = 0;
  for (const person of reportById.values()) {
    if (byId.has(person.id) || currentIds.has(person.id)) continue;
    console.log(`  RELEASED (report only): ${person.name} (${person.nameNumber})`);
    const entry = {
      ...person,
      status: 'released',
      firstSeen: now,
      releaseSource: 'official',
      // We never saw this person on the roster; everything came from the
      // release report (which has no charge dispositions).
      fromReleaseReport: true,
      baseline: false
    };
    log.push(entry);
    byId.set(entry.id, entry);
    reportOnlyCount++;
  }

  log.sort((a, b) => (b.bookedAt || '').localeCompare(a.bookedAt || ''));

  writeJSON(LOG_FILE, log);
  writeJSON(STATUS_FILE, { inCustody: currentIds.size, lastUpdated: now, rosterReportRunAt: roster.reportRunAt });
  writeJSON(STATS_FILE, buildStats(log, now));
  console.log(`[${nowLocalIso()}] Done. ${newCount} new, ${releasedCount} released, ${reportOnlyCount} report-only, ${currentIds.size} in custody.`);
}

run().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
