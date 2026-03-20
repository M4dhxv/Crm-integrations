# CRM Integration & Normalization Hub

A production-grade web application to connect, sync, and normalize data from modern CRMs seamlessly.

The Hub connects to external providers via OAuth, pulls records (Contacts, Deals, Companies) through a continuous sync worker daemon, and drops them into a dedicated robust normalization engine to enforce data mapping and formatting consistency.

## Features

- **Multi-Provider Connections**: Native support mappings and OAuth flows for Salesforce, HubSpot, Pipedrive, and Gong.
- **Data Normalization Engine**: Translates complex, distinct API definitions into a single, unified database schema. Evaluates emails (RFC-5322 pattern), format-checks phone numbers to E.164 standard, standardizes currency ISOs, and Title Casing inputs.
- **Data Quality Scoring**: Weights record completeness per entity out of 100 on an interactive dashboard.
- **Production Hardened**: In-memory rate limiting, IP tracking, structured logging, JWT Supabase integrations, and central error handlers.
- **Real-time Stats Dashboard**: View coverage heatmaps, connection health, and historical sync logs seamlessly. 

## System Architecture

Consists of a frontend Vite application, an Express backend server, a separate background polling Node sync worker, and PostgreSQL (via Supabase).

- **Frontend**: Premium dark-theme glassmorphism UI built entirely on vanilla CSS and HTML JS Modules.
- **Backend API (`server.js`)**: Serves the REST protocol for `/api/connections` and `/api/normalized`, orchestrates the OAuth flows.
- **Sync Worker (`worker.js`)**: Runs in the background and sequentially executes queued synchronization jobs natively polling from Supabase via `sync_jobs`. 

## Prerequisites
- Node.js (v18+)
- Local or Cloud Supabase Project

## Environment Setup

Inside `/backend`, copy the example ruleset to an active environment list:
```bash
cp .env.example .env
```

You must explicitly add your keys configuration for:
- `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_KEY`
- Your respective OAuth identifiers (`SALESFORCE_CLIENT_ID`, `HUBSPOT_CLIENT_ID`, etc).

## Installation

Install all needed workspace dependencies (run from root directory):

```bash
npm install 
cd backend && npm install
cd ..
```

## Running the Application

This is a multi-tier application. You'll need three separate terminal processes/tabs.

**1. Frontend Dev Server**
```bash
npx vite --port 5174
```
**2. Backend API**
```bash
cd backend
npm run dev
```
**3. Data Sync Background Worker**
```bash
cd backend
npm run dev:worker
```

## Creating Database Schemas

Push the migrations found in `/supabase/migrations/` sequentially into your Supabase Dashboard SQL Editor directly to establish the appropriate raw databases and normalization engines:
- `001_crm_schema.sql` (Creates core base)
- `003_normalization_layer.sql` (Appends Mapping & Quality Rulesets)
