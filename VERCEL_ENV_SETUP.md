# Vercel Environment Variables Setup Guide

## Step 1: Set Environment Variables in Vercel

1. Go to **Vercel Dashboard** → Your Project
2. Click **Settings** → **Environment Variables**
3. Add each variable below:

### Supabase Credentials (Required)

```
Name: VITE_SUPABASE_URL
Value: https://[your-project].supabase.co
Environments: Production, Preview, Development
```

```
Name: VITE_SUPABASE_ANON_KEY
Value: [Copy from Supabase → Settings → API Keys → anon public]
Environments: Production, Preview, Development
```

```
Name: SUPABASE_SERVICE_KEY
Value: [Copy from Supabase → Settings → API Keys → service_role secret]
Environments: Production, Preview, Development
```

### Salesforce OAuth (Optional - for OAuth flow)

```
Name: SALESFORCE_CLIENT_ID
Value: [See instructions below]
Environments: Production, Preview, Development
```

```
Name: SALESFORCE_CLIENT_SECRET
Value: [See instructions below]
Environments: Production, Preview, Development
```

### HubSpot OAuth (Optional)

```
Name: HUBSPOT_CLIENT_ID
Value: [See instructions below]
Environments: Production, Preview, Development
```

```
Name: HUBSPOT_CLIENT_SECRET
Value: [See instructions below]
Environments: Production, Preview, Development
```

### Outreach OAuth (Optional)

```
Name: OUTREACH_CLIENT_ID
Value: [See instructions below]
Environments: Production, Preview, Development
```

```
Name: OUTREACH_CLIENT_SECRET
Value: [See instructions below]
Environments: Production, Preview, Development
```

### URLs (Optional - will auto-detect if not set)

```
Name: BACKEND_URL
Value: https://[your-vercel-project].vercel.app
Environments: Production, Preview, Development
```

```
Name: FRONTEND_URL
Value: https://[your-vercel-project].vercel.app
Environments: Production, Preview, Development
```

### Cron Worker Security (Recommended)

```
Name: CRON_SECRET
Value: [Generate a long random secret]
Environments: Production, Preview, Development
```

Used by `/api/cron/sync` to securely process queued sync jobs on Vercel Cron.

---

## Step 2: Get OAuth Credentials from CRM Platforms

### Salesforce

1. **Login to Salesforce** (as admin)
2. Go to **Setup** (gear icon) → **Apps** → **Connected Apps**
3. Click **New Connected App**
4. Fill in:
   - **Connected App Name**: `CRM Integrations`
   - **API Name**: `crm_integrations`
   - **Contact Email**: your email
5. Scroll to **OAuth Settings**
6. Check: **Enable OAuth Settings**
7. **Callback URL**: 
   ```
   https://[your-vercel-project].vercel.app/api/callback/salesforce
   ```
8. **OAuth Scopes** - Select:
   - `api` (Access and manage your data)
   - `refresh_token` (Obtain refresh token)
   - `offline_access` (Access your data anytime)
9. Click **Save**
10. Click **Continue** on confirmation
11. Wait 10 seconds, then refresh page
12. Click the app name to open
13. **Copy these values to Vercel**:
    - **Consumer Key** → `SALESFORCE_CLIENT_ID`
    - **Consumer Secret** → `SALESFORCE_CLIENT_SECRET`

### HubSpot

1. **Login to HubSpot** (as admin)
2. Go to **Marketplace** → **Develop apps** → **My apps**
3. Click **Create app**
4. Go to **Auth** tab
5. Set **Redirect URLs**:
   ```
   https://[your-vercel-project].vercel.app/api/callback/hubspot
   ```
6. Go to **Scopes** tab
7. Search and select:
   - `crm.objects.contacts.read`
   - `crm.objects.companies.read`
   - `crm.objects.deals.read`
   - `crm.objects.leads.read` (if available)
8. Go to **Auth** tab
9. **Copy to Vercel**:
    - **Client ID** → `HUBSPOT_CLIENT_ID`
    - **Client Secret** → `HUBSPOT_CLIENT_SECRET`
10. Click **Save**

### Outreach

1. **Login to Outreach** (as admin)
2. Go to **Settings** → **API & Integrations** → **Connected Apps**
3. Click **New App**
4. Fill:
   - **App Name**: `CRM Integrations`
5. Go to **OAuth** section
6. Set **Redirect URI**:
   ```
   https://[your-vercel-project].vercel.app/api/callback/outreach
   ```
7. Select **Scopes**: (contact, account, opportunity read access)
8. **Copy to Vercel**:
    - **Client ID** → `OUTREACH_CLIENT_ID`
    - **Client Secret** → `OUTREACH_CLIENT_SECRET`

---

## Step 3: Deploy to Vercel

1. Push code to GitHub
2. Vercel will auto-redeploy with new env vars
3. Wait for deployment to complete (usually 2-3 min)

---

## Step 4: Test OAuth Flow

1. Open app: `https://[your-vercel-project].vercel.app`
2. Login
3. Go to **Connectors** → **Salesforce**
4. Click **Connect to Salesforce** button
5. Redirects to Salesforce login
6. Authorize app
7. Redirected back to dashboard with data syncing

---

## Environment Variables Summary Table

| Variable | Required | Source | Example |
|----------|----------|--------|---------|
| `VITE_SUPABASE_URL` | ✅ | Supabase API Settings | `https://abc123.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | ✅ | Supabase API Keys (anon) | `eyJ...` |
| `SUPABASE_SERVICE_KEY` | ✅ | Supabase API Keys (service role) | `eyJ...` |
| `SALESFORCE_CLIENT_ID` | ❌ | Salesforce Connected App | `3MV...` |
| `SALESFORCE_CLIENT_SECRET` | ❌ | Salesforce Connected App | `4A7...` |
| `HUBSPOT_CLIENT_ID` | ❌ | HubSpot App | `12345...` |
| `HUBSPOT_CLIENT_SECRET` | ❌ | HubSpot App | `abc123...` |
| `OUTREACH_CLIENT_ID` | ❌ | Outreach App | `client-id...` |
| `OUTREACH_CLIENT_SECRET` | ❌ | Outreach App | `secret...` |
| `BACKEND_URL` | ❌ | Your Vercel URL | `https://myapp.vercel.app` |
| `FRONTEND_URL` | ❌ | Your Vercel URL | `https://myapp.vercel.app` |
| `CRON_SECRET` | ❌ (recommended) | Random secret you generate | `a-long-random-string` |

---

## Troubleshooting

### "Salesforce OAuth not configured"
- ✅ Check if `SALESFORCE_CLIENT_ID` and `SALESFORCE_CLIENT_SECRET` are set in Vercel
- ✅ Make sure they're set in **Production** environment
- ✅ Redeploy after adding env vars

### "Invalid redirect URI"
- ✅ Make sure redirect URL in CRM app settings exactly matches:
  - `https://[your-vercel-project].vercel.app/api/callback/salesforce`
- ✅ No trailing slashes
- ✅ Must be HTTPS (not HTTP)

### Still seeing "Salesforce OAuth not configured"
- Use **Option A: Manual Credentials** instead (simpler, works immediately)
- Get OAuth token from your Salesforce user settings
- Paste directly in UI

---

## Quick Checklist

- [ ] Supabase URL and keys copied to Vercel
- [ ] Salesforce Connected App created (if using OAuth)
- [ ] HubSpot App created (if using OAuth)
- [ ] OAuth redirect URLs configured in each CRM
- [ ] All env vars added to Vercel
- [ ] Vercel deployment complete
- [ ] Test with OAuth button or manual token
