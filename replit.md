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
    crm/         # XCT-1 — Customer Relationship Management (+ Phase 2: lead scoring, automation)
    hrm/         # XCT-2 — Human Resources Management & Payroll (+ Phase 2: payroll engine, performance)
    ticketing/   # XCT-3 — Support Ticketing & Workflow Automation (+ Phase 2: SLA, routing)
    chat/        # XCT-4 — Internal Chat & Live Chat Widget (+ Phase 2: file sharing, rich media)
    analytics/   # XCT-5 — Advanced Analytics & Data Visualization (+ Phase 2: report builder, predictions)
  middleware/
    auth.ts      # JWT verification via @webwaka/core
    tenant.ts    # x-tenant-id header validation
  stubs/
    dexie.js     # Browser-only stub for @webwaka/core's offline queue
  worker.ts      # Main entry point
migrations/      # D1 SQL migrations (001–005)
```

## Phase 2 Enhancement Tasks (WebWaka OS v4 Taskbook)

All 10 Phase 2 tasks are fully implemented:

| Task | Description | Key Endpoints |
|------|-------------|---------------|
| **CC-CRM-001** | Lead Scoring | `GET/POST/PATCH/DELETE /api/crm/scoring-rules`, `POST /api/crm/leads/:id/recalculate-score` |
| **CC-CRM-002** | Marketing Automation | `GET/POST/PATCH/DELETE /api/crm/automation/workflows`, `POST /api/crm/automation/:id/trigger` |
| **CC-HRM-001** | Nigerian Payroll (PAYE) | `POST /api/hrm/payroll/preview`, `POST /api/hrm/payroll/run`, `GET /api/hrm/payroll`, `GET /api/hrm/payroll/:id/slips` |
| **CC-HRM-002** | Performance Management | `GET/POST/PATCH/DELETE /api/hrm/goals`, `GET/POST /api/hrm/review-cycles`, `GET/POST/PATCH /api/hrm/reviews` |
| **CC-TKT-001** | SLA Management | `GET/POST/PATCH/DELETE /api/ticketing/sla-policies`, `GET /api/ticketing/sla-report` |
| **CC-TKT-002** | Automated Routing | `GET/POST/PATCH/DELETE /api/ticketing/routing-rules`, `POST /api/ticketing/tickets/:id/auto-route` |
| **CC-CHAT-001** | File Sharing | `POST /api/chat/files/register`, `GET /api/chat/conversations/:id/files` |
| **CC-CHAT-002** | Rich Media Support | `GET /api/chat/media-info`, `GET /api/chat/files/:id/media-meta` |
| **CC-ANL-001** | Custom Report Builder | `GET/POST /api/analytics/reports`, `POST /api/analytics/reports/:id/run`, `GET /api/analytics/reports/schema/sources` |
| **CC-ANL-002** | Predictive Analytics | `GET /api/analytics/predictions/metrics`, `POST /api/analytics/predictions` |

### Implementation Notes

- **Nigeria-first payroll**: 2024 Finance Act PAYE bands; pension 8% employee / 10% employer; NHF 2.5% of basic. All monetary values in kobo (integer). Preview endpoint returns naira floats for display.
- **Report builder security**: `ALLOWED_FIELDS` map prevents SQL injection; `sanitizeField()` validates every column. Aliases are validated against derived alias set before ORDER BY expression.
- **File sharing**: Backend registers file metadata only — clients upload directly to R2/CDN then call `/api/chat/files/register`. Participant-only access enforced.
- **Predictive analytics**: All AI requests routed through `webwaka-ai-platform` (`AI_PLATFORM_URL` + `AI_PLATFORM_TOKEN`). Statistical fallback when AI unavailable. 24h cache.
- **Routing engine**: Keyword extraction + urgency detection (`critical` override). Fallback logging when no rule matches. Full routing audit log.
- **Anti-drift**: No auth/RBAC/KYC logic in this repo — handled by `webwaka-core`.

## Development

The app runs on **port 5000** using `wrangler dev`:

```bash
npm install
npm run dev      # Runs wrangler dev --ip 0.0.0.0 --port 5000
npm test         # vitest unit tests
```

### Local D1 Migrations

Apply all migrations to the local dev database (skip PRAGMA WAL — blocked in Miniflare):

```bash
for f in migrations/001_initial_schema.sql migrations/002_analytics_schema.sql \
         migrations/003_crm_enhancements.sql migrations/004_ticketing_enhancements.sql \
         migrations/005_phase2_enhancements.sql; do
  grep -v "PRAGMA" "$f" > /tmp/m.sql
  npx wrangler d1 execute webwaka-cross-cutting-db-dev --local --file=/tmp/m.sql
done
```

Note: `migrations/002_analytics_schema.sql` uses MySQL-style inline `INDEX` syntax (pre-existing). Apply manually with index lines removed for local dev; production Cloudflare D1 handles it correctly.

### Notes

- `dexie` is aliased to a stub (`src/stubs/dexie.js`) for Worker bundling compatibility.
- `JWT_SECRET = "dev-secret-for-local-testing-only"` is set in `[vars]` for local dev only — never used in production (set via `wrangler secret put`).

## API Endpoints

All API routes require `x-tenant-id` header and JWT Bearer token.

- `GET /health` — Service health check (no auth required)
- `GET/POST/PATCH/DELETE /api/crm/*` — CRM contacts, deals, pipeline, lead scoring, automation
- `GET/POST/PATCH/DELETE /api/hrm/*` — HR staff, payroll, leave, goals, performance reviews
- `GET/POST/PATCH/DELETE /api/ticketing/*` — Support tickets, SLA policies, routing rules
- `GET/POST /api/chat/*` — Conversations, messages, file sharing, rich media
- `GET/POST /api/analytics/*` — Events, metrics, custom reports, predictive analytics

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ENVIRONMENT` | Environment name (development/staging/production) |
| `JWT_SECRET` | JWT signing secret (shared with all WebWaka services) |
| `AI_PLATFORM_URL` | WebWaka AI Platform base URL |
| `AI_PLATFORM_TOKEN` | Service-to-service bearer token for AI platform |
| `INTER_SERVICE_SECRET` | Shared secret for cross-vertical service calls |

## Database Schema

Migrations `001`–`005` cover all tables. Key Phase 2 additions (migration `005`):

- `crm_scoring_rules`, `crm_lead_score_events` — CC-CRM-001
- `crm_automation_workflows`, `crm_automation_execution_log` — CC-CRM-002
- `hrm_payroll_configs`, `hrm_payroll_runs`, `hrm_pay_slips` — CC-HRM-001
- `hrm_goals`, `hrm_review_cycles`, `hrm_performance_reviews`, `hrm_feedback` — CC-HRM-002
- `ticket_sla_policies`, `ticket_sla_events` — CC-TKT-001
- `ticket_routing_rules`, `ticket_routing_log` — CC-TKT-002
- `chat_files` — CC-CHAT-001
- `analytics_report_definitions`, `analytics_report_runs` — CC-ANL-001
- `analytics_prediction_cache` — CC-ANL-002

## Deployment

Configured for Replit autoscale deployment running `npm run dev`.
For production Cloudflare deployment: `npm run deploy`
