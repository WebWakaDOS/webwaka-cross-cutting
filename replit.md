# WebWaka Cross-Cutting Worker

## Overview

**WebWaka Cross-Cutting Modules** — shared functional modules for the WebWaka OS v4 platform. This is a **Cloudflare Workers** backend API built with [Hono](https://hono.dev/) and TypeScript.

## Architecture

- **Runtime**: Cloudflare Workers (via Wrangler)
- **Framework**: Hono v4
- **Language**: TypeScript (ES2022, Workers-compatible)
- **Bindings**: D1 (SQLite), KV Namespaces
- **Package Manager**: npm

## Module Structure

```
src/
  modules/
    crm/         # XCT-1 — Customer Relationship Management
    hrm/         # XCT-2 — Human Resources Management & Payroll
    ticketing/   # XCT-3 — Support Ticketing & Workflow Automation
    chat/        # XCT-4 — Internal Chat & Live Chat Widget
    analytics/   # XCT-5 — Advanced Analytics & Data Visualization
  middleware/
    auth.ts      # JWT verification via @webwaka/core
    tenant.ts    # x-tenant-id header validation
  stubs/
    dexie.js     # Browser-only stub for @webwaka/core's offline queue
  worker.ts      # Main entry point
migrations/      # D1 SQL migrations
```

## Development

The app runs on **port 5000** using `wrangler dev`:

```bash
npm install
npm run dev      # Runs wrangler dev --ip 0.0.0.0 --port 5000
npm test         # vitest unit tests
```

### Notes

- `dexie` is aliased to a stub (`src/stubs/dexie.js`) because `@webwaka/core` includes a browser-only offline queue module that would otherwise fail to bundle in Workers.
- The `[dev]` section in `wrangler.toml` configures the local dev server host/port.
- D1 and KV bindings are only required for production (configured in `wrangler.toml` production env).

## API Endpoints

All API routes require `x-tenant-id` header and JWT Bearer token.

- `GET /health` — Service health check (no auth required)
- `GET/POST/PATCH/DELETE /api/crm/*` — CRM contacts, deals, pipeline, activities
- `GET/POST/PATCH/DELETE /api/hrm/*` — HR staff, payroll, leave management
- `GET/POST/PATCH/DELETE /api/ticketing/*` — Support tickets, workflows
- `GET/POST/PATCH /api/chat/*` — Conversations and messages
- `GET/POST /api/analytics/*` — Analytics events and reports

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ENVIRONMENT` | Environment name (development/staging/production) |
| `JWT_SECRET` | JWT signing secret (shared with other WebWaka services) |
| `AI_PLATFORM_URL` | WebWaka AI Platform base URL |
| `AI_PLATFORM_TOKEN` | Service-to-service bearer token |
| `INTER_SERVICE_SECRET` | Shared secret for cross-vertical calls |

## Deployment

Configured for Replit autoscale deployment running `npm run dev`.
For production Cloudflare deployment: `npm run deploy`
