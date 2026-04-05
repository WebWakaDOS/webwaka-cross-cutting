# webwaka-cross-cutting

**WebWaka Cross-Cutting Modules** — shared functional modules that operate across all verticals in WebWaka OS v4.

Blueprint Reference: *Part 10.12 — Customer & Staff Operations, Communication, Data & Assets*

## Epics

| Epic | Module | Status | Dependencies |
|------|--------|--------|--------------|
| XCT-1 | Customer Relationship Management (CRM) | 🚧 Planned | CORE-2 |
| XCT-2 | Human Resources Management & Payroll | 🚧 Planned | CORE-2 |
| XCT-3 | Support Ticketing & Workflow Automation | 🚧 Planned | CORE-2, CORE-5 |
| XCT-4 | Internal Chat & Live Chat Widget | 🚧 Planned | CORE-2 |
| XCT-5 | Advanced Analytics & Data Visualization | 🚧 Planned | CORE-5 |

## Architecture

This repo is a **Cloudflare Workers** monorepo. Each epic lives in `src/modules/<module>/`.

```
src/
  modules/
    crm/         # XCT-1
    hrm/         # XCT-2
    ticketing/   # XCT-3
    chat/        # XCT-4
    analytics/   # XCT-5
  middleware/
    auth.ts
    tenant.ts
  worker.ts
migrations/
```

## Setup

```bash
npm install
npm run dev      # local dev via wrangler
npm test         # vitest unit tests
npm run deploy   # wrangler deploy --env production
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `AI_PLATFORM_URL` | webwaka-ai-platform base URL |
| `AI_PLATFORM_TOKEN` | Service-to-service bearer token |
| `INTER_SERVICE_SECRET` | Shared secret for cross-vertical calls |

## Contributing

See [WebWaka Contribution Guidelines](https://github.com/WebWakaDOS/webwaka-platform-docs/blob/main/content/contribution-guidelines.md).

