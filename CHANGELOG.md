# Changelog

All notable changes to this project will be documented in this file.

## [1.1.0] - Production Normalization Layer

### Added
- **Normalization Engine**: Added a complete backend normalization layer in `backend/normalizer` that maps, transforms, and standardizes heterogeneous CRM data to a unified platform model.
- **Data Standardization**: Reusable standardizers for names (Title Case), emails (RFC-5322), phone numbers (E.164), addresses, and currencies (ISO 4217).
- **Quality Scorer**: Per-record weighted grading system (0-100) that evaluates field completeness and formatting validation per target entity type.
- **Normalization Run History**: Added `normalization_runs` database mapping to track pipeline runs, successful records processed, errored out transformations, and duration.
- **Data Sync Engine (Background Worker)**:
  - Added `backend/worker.js` as a continuous daemon to poll and execute `sync_jobs`.
  - Built production **Salesforce** API adapter with `v58.0/query` SOQL fetching.
  - Built production **HubSpot** API adapter using `v3/search` endpoints.
- **API Endpoints**: New `/api/normalized/*` and `/api/connections` API routes built over Express.
- **Normalization Dashboard UI**: 
  - Brand new `/normalization.html` page featuring cross-platform metrics, quality SVG gauges, and a field coverage heatmap.
  - Added Data Quality widget immediately available on `/dashboard.html`.

### Changed
- **Server Production Hardening**: Server updated with centralized structured JSON error-handling, request tracing/logging, in-memory IP rate limiting, and JWT-authenticated Supabase middleware.
- **Database Schema Updates (`003_normalization_layer.sql`)**:
  - `field_mapping_registry` created and seeded with 6 default CRMs mapping dictionaries.
  - `normalization_rules` engine mapping introduced.
  - `platform_analytics` view created to easily aggregate overall API health per provider connection.
- **Dashboard UI Enhancements**: Upgraded dashboard styling to account for new Normalization routing and metrics stats blocks.
