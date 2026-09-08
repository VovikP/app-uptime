# app-uptime

An independent availability record for Atlassian Marketplace apps.

Two things get recorded for each vendor, every 10 minutes:

1. **What the vendor says** — their own status page (`/api/v2/summary.json`).
2. **What a direct probe shows** — an unauthenticated request to their public API.

The point is not either line on its own. It is **where the two disagree**: the
status page reporting "All Systems Operational" while the API returns 5xx or
nothing at all.

No credentials. No access to anyone's Jira. Nothing installed anywhere. The probe
is a single unauthenticated GET; a `401` answered in 200 ms proves the service is
alive, a `502` or silence proves it is not.

## Why

I pulled every 1- and 2-star review with text from 22 of the largest paid
Marketplace apps — 431 reviews. Roughly half describe a technical failure rather
than price or support. Reading the 2025–2026 ones individually, the biggest single
cluster is the app not working for days or weeks while the admin hears about it
from their own users:

> "Plugin is not loading from last two weeks and there is no resolution yet."

> "Outage for over 22hrs, no communication, even the status page is sending mixed signals."

I then checked whether vendors' own status pages had declared incidents around the
dates of those complaints. **Within the window each status feed actually covers,
6 of 7 had none within ±7 days.**

**That n is 7 and it proves nothing.** A perfectly innocent explanation fits: those
may have been single-tenant problems, which a global status page correctly reports
as operational — and the admin still has no way to know. That uncertainty is the
reason this repository exists. Outage history cannot be reconstructed after the
fact, so the recording starts now and the question gets answered later, with data.

Discussion with Jira admins:
<https://community.atlassian.com/forums/Jira-Cloud-Admins-discussions/431-negative-reviews-of-the-biggest-paid-Jira-apps-half-are/m-p/3285876>

## Data

`data/YYYY-MM.jsonl` — one JSON object per vendor per run.

```json
{
  "at": "2026-09-07T20:15:39.712Z",
  "vendor": "tempo",
  "status": { "reachable": true, "indicator": "none",
              "description": "All Systems Operational",
              "openIncidents": [], "degradedComponents": [] },
  "probe":  { "verdict": "live", "httpStatus": 401, "ms": 214 },
  "divergence": null
}
```

`verdict` is one of `live`, `server-error`, `no-response`, `unexpected`.
`divergence` is set to `status-says-ok-probe-fails` when the status page reports
no problem while the probe fails — otherwise `null`.

### Known defects in the record

Honesty about the data matters more than a tidy history, so nothing is deleted:

- **The first 6 rows (2026-09-07T20:15Z) have `openIncidents: null`.** The
  collector was calling `/api/v2/incidents/unresolved.json`, which does not exist
  and silently returns an HTML 404. Fixed by moving to `summary.json`. Those rows
  are still real observations of the status indicator and the probe; only the
  incident list is missing.

## Coverage

6 vendors — 4 with a machine-readable status feed, 3 with a usable direct probe.
Vendors without either are listed in `feeds.json` with `null` so the gap is visible
rather than silently absent. Additions welcome, particularly status page URLs for
Adaptavist, SmartBear and BigPicture, which I could not find.

## Running it

```bash
node collect.js
```

Appends to `data/`. No configuration, no secrets. GitHub Actions runs the same
command on a schedule and commits the result.

## Method, so you can check it

Review counts come from the public Marketplace API
(`/rest/2/addons/{key}/reviews`). "Largest" apps were ranked by installs
multiplied by list price at the 50-user tier — a proxy, not actual revenue.
Classification of review text by keyword is fragile: a narrow word list gives
48.7% technical, a wider one 52.4%. Both numbers are reported rather than the
more convenient one.

MIT.
