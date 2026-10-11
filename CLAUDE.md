# Skagit Jail Roster — Project Context

## What it is
A public jail roster monitor for Skagit County, WA, built from the same
template as `recordwatch/clark-county-monitor`, `lewis-county-monitor` and
`cowlitz-county-monitor` (modeled on the Kitsap monitor). Scrapes the jail
roster, tracks bookings and releases, and serves a static site.

## Sources
- https://classic.skagitcountywa.gov/Reporting/JailRoster/ — one ~2.5 MB
  ASP.NET page; the county regenerates it every 15 minutes ("Report Run on").
  Each person is a name row (`tr#<num>Name`: last, first, middle, suffix,
  Name Number) followed by a hidden detail row (`tr#<num>`): incarceration
  date+time, scheduled release, housing, then one table per arrest (date,
  type, agency, location) with its charges (offense date, description,
  incident, court, court reference, bail amount/type, disposition).
- https://classic.skagitcountywa.gov/Reporting/JailRelease/ — same layout,
  people released in the past 48 hours, with "Release date" instead of
  "Scheduled Release" and **no Disposition column**. Regenerated **once a
  day at 6 a.m.**
- Only `classic.skagitcountywa.gov` needs to be reachable; the cloud dev
  environment allows that host explicitly.

## Architecture
- **Scraper:** `scrape.js` (orchestrator) + `scrapers/skagit.js` (Cheerio parsing), Node 20 built-in fetch
- **Schedule:** `.github/workflows/scrape.yml`, cron every 30 min (backup only — see Scheduling)
- **Storage:** JSON committed to `data/` — no server, no database
- **Frontend:** React + Vite in `frontend/`, built and pushed to the `gh-pages` branch

## Key facts / gotchas
- "Name Number" is a **per-person** number (also the VINE offender ID). A
  booking's `id` is `<nameNumber>-<incarceration datetime digits>`; the
  roster and release report share it, so releases match exactly.
- Dates are `HH:MM:SS MM/DD/YY` (2-digit year) Pacific; stored as
  `YYYY-MM-DDTHH:MM:SS`, so they sort as strings.
- Charge columns are read **by header name**, because the release report
  omits Disposition.
- Arrests are not listed in date order on the page; they're sorted, and the
  earliest one sets `arrestingAgency` / `arrestType`.
- **Arrest Location is intentionally not stored** — it's often a street
  address and `data/` is public.
- Release: `releaseSource: 'official'` when the release report lists the
  same id, else `'observed'` (scrape time); retried for 3 days because the
  report only updates at 6 a.m.
- Bookings that start and end between two runs never reach the roster; the
  release report still lists them, so they're added with
  `fromReleaseReport: true` (no dispositions on those charges).
- Housing includes non-cell placements (ELECTRONIC HOME MONITORING, work
  release, community service work) — those people are counted as in custody
  because the county lists them.
- `bondTotal` sums every charge's bail amount; "Included" amounts are not
  counted.
- Court codes: SC Superior, DC District, BMC/MVMC/AMC/SWMC = Burlington /
  Mount Vernon / Anacortes / Sedro-Woolley Municipal; TC and UTC unknown.
- Safety: if the roster comes back empty or < 50% of the previous in-custody
  count, the run exits non-zero without marking anyone released.

## Scheduling (important)
- GitHub's own `schedule:` cron is unreliable for small repos — Kitsap's
  measured gaps were 3–9 hours (median ~5.5 h), not 30 minutes.
- The real trigger should be an external **cron-job.org** job that POSTs
  every 30 minutes to
  `https://api.github.com/repos/recordwatch/skagit-county-monitor/actions/workflows/scrape.yml/dispatches`
  with body `{"ref":"main"}`, using the same fine-grained token as the other
  county repos (Actions: read & write). That token must include this repo.

## Data files
- `data/change_log.json` — every booking ever seen, newest `bookedAt` first
- `data/stats.json` — precomputed stats (`stats.js`)
- `data/status.json` — `{ inCustody, lastUpdated, rosterReportRunAt }`

## Local dev
- `ROSTER_HTML_FILE=r.html RELEASES_HTML_FILE=rel.html node scrape.js` parses saved pages
- Frontend: copy `data/*.json` into `frontend/public/data/`, then `cd frontend && npm run dev`
