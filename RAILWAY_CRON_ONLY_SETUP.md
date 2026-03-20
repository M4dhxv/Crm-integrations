# Railway Cron-Only Setup (No Always-Running Service)

This setup runs sync as a scheduled job that starts, processes a small batch, and exits.

## Guarantee

- No persistent worker process
- No long-running loop
- No always-running server required for sync execution

The script used is [backend/cron-sync.js](backend/cron-sync.js).

---

## 1) Create Railway service from this repo

1. Railway → New Project → Deploy from GitHub
2. Select this repo
3. Set **Root Directory** to `backend`

---

## 2) Start command (run-once)

Set service Start Command to:

`npm run cron:sync`

This command executes once and exits.

---

## 3) Add environment variables

Set these in Railway service variables:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_KEY`
- `HUBSPOT_CLIENT_ID`
- `HUBSPOT_CLIENT_SECRET`

Optional tuning:

- `CRON_SYNC_BATCH_SIZE=3`
- `CRON_SYNC_SCRIPT_TIMEOUT_MS=480000`
- `CRON_SYNC_JOB_TIMEOUT_MS=90000`
- `CRON_SYNC_DB_RETRIES=3`

---

## 4) Configure Railway schedule

In Railway service settings, add schedule:

`*/10 * * * *`

This runs every 10 minutes.

---

## 5) Behavior per run

Each run:

1. Fetches due jobs in small batch
2. Processes sequentially with timeout + retry protections
3. Logs start/end/errors
4. Exits cleanly

---

## 6) Verification

Check logs for:

- `cron-sync start`
- `jobs fetched`
- `job success` / `job failed`
- `cron-sync finished`

And verify in Supabase:

```sql
select status, count(*)
from sync_jobs
group by status;
```

No persistent process is required.
