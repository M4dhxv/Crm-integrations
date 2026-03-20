# Railway Backend Deployment Guide

This project works best on Railway by running **two services** from the same repo:

- API service (Express): `backend/server.js`
- Worker service (poller): `backend/worker.js`

---

## 1) Create API service

1. Railway Dashboard → **New Project** → **Deploy from GitHub Repo**
2. Select this repo.
3. Open service settings and set:
   - **Root Directory**: `backend`
   - **Start Command**: `npm run start`

---

## 2) Create Worker service

1. In the same Railway project, click **New Service** → **GitHub Repo**.
2. Select the same repo.
3. Set:
   - **Root Directory**: `backend`
   - **Start Command**: `npm run worker`

This keeps queue processing always on.

---

## 3) Add environment variables (both services)

Set these on **API** and **Worker** services:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_KEY`
- `BACKEND_URL` (use API public URL)
- `FRONTEND_URL` (your frontend URL)
- `HUBSPOT_CLIENT_ID`
- `HUBSPOT_CLIENT_SECRET`
- `OAUTH_STATE_SECRET` (long random string)

Optional:
- `SALESFORCE_CLIENT_ID`
- `SALESFORCE_CLIENT_SECRET`
- `OUTREACH_CLIENT_ID`
- `OUTREACH_CLIENT_SECRET`

---

## 4) Point frontend to Railway API

In Vercel frontend envs:

- `VITE_BACKEND_URL=https://<your-railway-api-domain>`

Redeploy frontend.

---

## 5) Verify

- API health: `https://<railway-api-domain>/api/health`
- Config status: `https://<railway-api-domain>/api/config-status`

Then in app:

1. Reconnect HubSpot.
2. Click **Sync Now**.
3. Check `sync_jobs` in Supabase → should move from `pending` to `running/completed`.

---

## Notes

- Railway avoids serverless worker limitations seen on Vercel Hobby.
- Keep Vercel for frontend and Railway for backend+worker.
