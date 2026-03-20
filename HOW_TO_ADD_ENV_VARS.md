# Step-by-Step: Add Environment Variables to Vercel

## Part 1: Get Your Supabase Keys

### Step 1.1: Open Supabase
1. Go to https://supabase.com
2. Login to your account
3. Click on your **project** in the list

### Step 1.2: Find API Keys
1. In left sidebar, click **Settings** (gear icon)
2. Click **API** tab
3. You'll see:
   - **Project URL** (starts with `https://`)
   - **Anon Key** (public key)
   - **Service Role Key** (secret key - keep private!)

### Step 1.3: Copy the 3 Keys
```
VITE_SUPABASE_URL = [Project URL]
VITE_SUPABASE_ANON_KEY = [Anon Key]
SUPABASE_SERVICE_KEY = [Service Role Key]
```

Write these down or keep the tab open.

---

## Part 2: Add Variables to Vercel

### Step 2.1: Go to Vercel Dashboard
1. Go to https://vercel.com
2. Login
3. Click your **project** (the CRM one)

### Step 2.2: Open Settings
1. Click the **Settings** tab at the top
2. Left sidebar: click **Environment Variables**

### Step 2.3: Add First Variable (VITE_SUPABASE_URL)

**Click "Add New"** and fill:

| Field | Value |
|-------|-------|
| **Name** | `VITE_SUPABASE_URL` |
| **Value** | Paste your Project URL from Supabase |
| **Environments** | ✅ Production ✅ Preview ✅ Development |

Click **Save**

### Step 2.4: Add Second Variable (VITE_SUPABASE_ANON_KEY)

**Click "Add New"** and fill:

| Field | Value |
|-------|-------|
| **Name** | `VITE_SUPABASE_ANON_KEY` |
| **Value** | Paste your Anon Key from Supabase |
| **Environments** | ✅ Production ✅ Preview ✅ Development |

Click **Save**

### Step 2.5: Add Third Variable (SUPABASE_SERVICE_KEY)

**Click "Add New"** and fill:

| Field | Value |
|-------|-------|
| **Name** | `SUPABASE_SERVICE_KEY` |
| **Value** | Paste your Service Role Key from Supabase |
| **Environments** | ✅ Production ✅ Preview ✅ Development |

Click **Save**

---

## Part 3: Get Salesforce OAuth Keys (Optional)

### Step 3.1: Login to Salesforce
1. Go to https://login.salesforce.com
2. Login with your admin account
3. Click the **gear icon** (top right) → **Setup**

### Step 3.2: Create Connected App
1. In left sidebar, search: `Connected Apps`
2. Click **Connected Apps**
3. Click **New Connected App**

### Step 3.3: Fill Connected App Form

| Field | Value |
|-------|-------|
| **Connected App Name** | `CRM Integrations` |
| **API Name** | `crm_integrations` (auto-fills) |
| **Contact Email** | Your email |

### Step 3.4: Enable OAuth
1. **Check** the box: "Enable OAuth Settings"
2. **Callback URL**: 
   ```
   https://[your-vercel-project].vercel.app/api/callback/salesforce
   ```
   
   *Replace `[your-vercel-project]` with your actual Vercel project name*
   
   Example: `https://mycrm-app.vercel.app/api/callback/salesforce`

### Step 3.5: Select OAuth Scopes
Find **OAuth Scopes** section. **Click "Add >"** and select:
- ✅ `api` (Access and manage your data)
- ✅ `refresh_token` (Obtain refresh token for offline use)  
- ✅ `offline_access` (Access your data anytime)

Then click **Add >>** to move them to Selected list.

### Step 3.6: Save
1. Scroll down
2. Click **Save**
3. Click **Continue** on the confirmation page
4. Wait 10 seconds
5. **Refresh the page**

### Step 3.7: Get the Keys
1. Click on your app name "CRM Integrations"
2. Scroll to **Consumer Key and Secret** section
3. Click **"Show"** next to the secret
4. **Copy both values:**
   - Consumer Key → `SALESFORCE_CLIENT_ID`
   - Consumer Secret → `SALESFORCE_CLIENT_SECRET`

---

## Part 4: Add Salesforce Keys to Vercel

### Step 4.1: Add SALESFORCE_CLIENT_ID

**Go back to Vercel** (keep Salesforce in another tab)

1. Click "Add New"
2. Fill:

| Field | Value |
|-------|-------|
| **Name** | `SALESFORCE_CLIENT_ID` |
| **Value** | Paste Consumer Key from Salesforce |
| **Environments** | ✅ Production ✅ Preview ✅ Development |

Click **Save**

### Step 4.2: Add SALESFORCE_CLIENT_SECRET

1. Click "Add New"
2. Fill:

| Field | Value |
|-------|-------|
| **Name** | `SALESFORCE_CLIENT_SECRET` |
| **Value** | Paste Consumer Secret from Salesforce |
| **Environments** | ✅ Production ✅ Preview ✅ Development |

Click **Save**

---

## Part 5: Deploy

### Step 5.1: Trigger Redeploy
1. Go to **Deployments** tab in Vercel
2. Click the **three dots** (⋮) on the latest deployment
3. Click **Redeploy**

Wait 2-3 minutes for deployment to complete.

### Step 5.2: Check Deployment Status
- Look for green checkmark ✅
- When done, your app URL will be active

---

## Part 6: Test It

### Step 6.1: Open Your App
1. Go to: `https://[your-vercel-project].vercel.app`
2. Login if needed

### Step 6.2: Test Salesforce Connection
1. Click **Connectors** → **Salesforce**
2. Click **"Connect to Salesforce"** button
3. You should be redirected to Salesforce login
4. Login and click **Allow**
5. Redirected back to your app with data syncing!

---

## Verification Checklist

- [ ] Supabase keys added to Vercel (3 variables)
- [ ] Salesforce keys added to Vercel (2 variables)
- [ ] All variables set for Production, Preview, Development
- [ ] Vercel redeployed successfully (green checkmark)
- [ ] App loads without errors
- [ ] Salesforce OAuth button works and redirects

---

## If Something Goes Wrong

### "Salesforce OAuth not configured"
- [ ] Check Vercel env vars are saved
- [ ] Make sure SALESFORCE_CLIENT_ID is not empty
- [ ] Make sure SALESFORCE_CLIENT_SECRET is not empty
- [ ] Check all 3 Environments are selected (Production, Preview, Development)
- [ ] Redeploy manually from Vercel

### "Invalid redirect URI"
- [ ] Check Salesforce callback URL is exactly: `https://[your-project].vercel.app/api/callback/salesforce`
- [ ] No typos
- [ ] Must be HTTPS (not HTTP)
- [ ] Make sure Salesforce app is saved

### Still not working?
- Use **Option A: Manual Token** instead (faster)
- Get OAuth token from Salesforce user settings
- Paste directly in the UI - no Vercel setup needed!

---

## Summary: All Variables You Need

After completing above steps, you should have these in Vercel:

```
VITE_SUPABASE_URL = https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY = eyJ...
SUPABASE_SERVICE_KEY = eyJ...
SALESFORCE_CLIENT_ID = 3MV...
SALESFORCE_CLIENT_SECRET = 4A7...
```

That's it! Your OAuth flow will work. 🚀
