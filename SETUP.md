# CRM Integration Setup Guide

## Quick Start

### 1. **Manual Credentials (No OAuth App Needed)**

You can add CRM credentials directly without configuring OAuth apps:

#### Salesforce
1. Go to **Connectors** → **Salesforce**
2. Scroll to **"OR paste Access Token"**
3. Paste your Salesforce OAuth token (get from: Salesforce → Settings → Personal Information → OAuth 2.0 Access Token)
4. Instance URL: `https://your-domain.my.salesforce.com`
5. Select objects (Contacts, Leads, Accounts, Opportunities)
6. Click **Save Connection**

✅ Data will automatically sync in background

#### HubSpot
1. Go to **Connectors** → **HubSpot**  
2. Paste your HubSpot OAuth access token (get from: HubSpot → Settings → API Keys)
3. Select objects
4. Click **Save Connection**

✅ Data syncs automatically

#### Gong, Pipedrive, Freshsales
1. Go to **Connectors** → [Provider Name]
2. **API Key**: Your provider API key
3. **Access Key** (Gong only): Gong access key
4. **Instance URL**: Your subdomain (e.g., `acme.pipedrive.com`)
5. Select objects
6. Click **Save Connection**

✅ Data syncs automatically

### 2. **Full OAuth Setup (Optional)**

For OAuth 2.0 flow (automatic token refresh):

#### Deploy Backend to Vercel

1. Connect GitHub repo to Vercel
2. Set environment variables in Vercel Project Settings:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_KEY=your-service-role-key
SALESFORCE_CLIENT_ID=your-client-id
SALESFORCE_CLIENT_SECRET=your-client-secret
HUBSPOT_CLIENT_ID=your-client-id
HUBSPOT_CLIENT_SECRET=your-client-secret
PIPEDRIVE_CLIENT_ID=your-client-id
PIPEDRIVE_CLIENT_SECRET=your-client-secret
OUTREACH_CLIENT_ID=your-client-id
OUTREACH_CLIENT_SECRET=your-client-secret
BACKEND_URL=https://your-vercel-project.vercel.app
FRONTEND_URL=https://your-vercel-project.vercel.app
```

3. Deploy both frontend + backend via Vercel

#### Salesforce OAuth App Setup

1. Go to Salesforce → Setup → Apps → Connected Apps
2. Create new Connected App:
   - **OAuth Scopes**: `api refresh_token offline_access`
   - **Callback URL**: `https://your-vercel-project.vercel.app/api/callback/salesforce`
3. Copy `Client ID` and `Client Secret` to Vercel env vars
4. In app UI, click "Connect to Salesforce" button

#### HubSpot OAuth App Setup

1. Go to HubSpot → App Marketplace → Develop apps → Create app
2. Set **Redirect URI**: `https://your-vercel-project.vercel.app/api/callback/hubspot`
3. Request scopes: `crm.objects.contacts.read`, `crm.objects.companies.read`
4. Copy Client ID/Secret to Vercel
5. In app, click "Connect to HubSpot" button

#### Pipedrive OAuth App Setup

1. Go to Pipedrive Developer Hub and create an OAuth app
2. Set **Redirect URI**: `https://your-vercel-project.vercel.app/api/callback/pipedrive`
3. Copy **Client ID** → `PIPEDRIVE_CLIENT_ID`
4. Copy **Client Secret** → `PIPEDRIVE_CLIENT_SECRET`
5. In app, click "Connect to Pipedrive" button

## How Data Fetching Works

### Flow Diagram

```
1. User adds credentials in UI
   ↓
2. Frontend calls /api/connections/auth-manual
   ↓
3. Backend stores connection + creates sync jobs
   ↓
4. Background worker polls sync_jobs table
   ↓
5. Worker calls CRM adapter (salesforce.js, hubspot.js, etc.)
   ↓
6. CRM adapter fetches data using stored credentials
   ↓
7. Raw data stored in Supabase raw.source_objects
   ↓
8. Normalization pipeline standardizes data
   ↓
9. Dashboard displays synced data
```

### Testing Data Fetch

To verify your credentials work and data fetches:

**POST** `/api/connections/test-fetch`
```json
{
  "connectionId": "your-connection-id",
  "objectType": "contacts"
}
```

Response:
```json
{
  "success": true,
  "provider": "salesforce",
  "objectType": "contacts",
  "recordsFetched": 142,
  "sampleRecords": [...]
}
```

### Sync Schedule

- **Real-time**: Webhooks (if provider supports)
- **Hourly**: Default (can be changed per connection)
- **Daily**: Once per day at midnight UTC
- **Manual**: Click "Sync Now" button

## Troubleshooting

### "Salesforce OAuth not configured"
- Need OAuth app setup (see Full OAuth Setup above)
- OR use Manual Credentials method instead

### "Failed to fetch contacts"
- Check if Access Token is valid (expired tokens won't work)
- Verify Instance URL matches your Salesforce org
- Check Supabase credentials in env vars

### Data not syncing
- Make sure backend worker is running (`npm run worker` locally or Vercel cron job)
- Check sync_jobs table for pending/failed jobs
- Verify objects are selected in connection settings

### Connection shows but no data appears
- Wait 10-30 seconds for sync worker to process
- Check raw.source_objects table in Supabase
- If sync_jobs shows "failed", check error_message column

## Architecture

```
frontend/          (Vite SPA)
├── connectors.js  (UI for adding CRMs)
├── dashboard.js   (shows synced data)
└── supabase.js    (auth client)

backend/           (Express server)
├── server.js      (REST APIs)
├── worker.js      (background sync daemon)
└── sync/
    ├── index.js   (sync orchestrator)
    └── adapters/
        ├── salesforce.js  (SOQL queries)
        ├── hubspot.js     (REST API)
        └── ...others
```

## Deployed URLs

- **Frontend**: https://your-vercel-project.vercel.app
- **Backend API**: https://your-vercel-project.vercel.app/api
- **Health Check**: https://your-vercel-project.vercel.app/api/health

## Support

For issues:
1. Check browser console for errors
2. Check Vercel deployment logs
3. Verify sync_jobs table in Supabase
4. Test with `/api/connections/test-fetch` endpoint
