# CRM Integrations Hub

A unified platform to connect, sync, and manage CRM data sources (Salesforce, HubSpot, Gong, Pipedrive, Outreach, Freshsales).

## Setup

1. Clone the repo
2. Copy `.env.example` to `.env` and fill in your Supabase credentials:
   ```bash
   cp .env.example .env
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
4. Run dev server:
   ```bash
   npm run dev
   ```
5. Build for production:
   ```bash
   npm run build
   ```

## Environment Variables

- `VITE_SUPABASE_URL` - Your Supabase project URL
- `VITE_SUPABASE_ANON_KEY` - Your Supabase anonymous key

## Deployment

Deploy the `dist/` directory to:
- Vercel
- Netlify
- Any static hosting

Remember to add your deployed domain to Supabase Auth settings (Site URL & Redirect URLs).

## Database

Run migrations from `supabase/migrations/001_crm_schema.sql` in your Supabase project.
