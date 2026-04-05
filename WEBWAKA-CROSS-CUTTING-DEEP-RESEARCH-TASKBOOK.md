# WEBWAKA-CROSS-CUTTING — DEEP RESEARCH + ENHANCEMENT TASKBOOK + QA PROMPT FACTORY

**Repository:** `webwaka-cross-cutting`
**Blueprint Reference:** Part 10.12 — Customer & Staff Operations, Communication, Data & Assets
**Author:** WebWaka Platform Research Agent
**Date:** April 2026
**Status:** Authoritative. This document supersedes all prior ad-hoc planning notes for this repo.

---

## TABLE OF CONTENTS

1. [Repo Deep Understanding](#1-repo-deep-understanding)
2. [External Best-Practice Research](#2-external-best-practice-research)
3. [Synthesis and Gap Analysis](#3-synthesis-and-gap-analysis)
4. [Top 20 Enhancements](#4-top-20-enhancements)
5. [Bug Fix Recommendations](#5-bug-fix-recommendations)
6. [Task Breakdown (Tasks T01–T26)](#6-task-breakdown)
7. [QA Plans](#7-qa-plans)
8. [Implementation Prompts](#8-implementation-prompts)
9. [QA Prompts](#9-qa-prompts)
10. [Priority Order](#10-priority-order)
11. [Dependencies](#11-dependencies)
12. [Phase 1 / Phase 2 Split](#12-phase-1--phase-2-split)
13. [Repo Context and Ecosystem Notes](#13-repo-context-and-ecosystem-notes)
14. [Governance and Reminder Block](#14-governance-and-reminder-block)
15. [Execution Readiness Notes](#15-execution-readiness-notes)

---

## 1. REPO DEEP UNDERSTANDING

### 1.1 Repository Identity

| Attribute | Value |
|---|---|
| **Name** | `webwaka-cross-cutting` |
| **NPM Package** | N/A (deployed as Cloudflare Worker) |
| **Runtime** | Cloudflare Workers (Miniflare locally) |
| **Framework** | Hono v4 |
| **Language** | TypeScript (strict mode) |
| **Database** | Cloudflare D1 (SQLite on edge) |
| **KV Store** | Cloudflare KV (sessions, tenant config) |
| **Entry Point** | `src/worker.ts` |
| **Worker Name** | `webwaka-cross-cutting-api` |
| **Blueprint** | Part 10.12 — XCT-1 through XCT-5 |

### 1.2 Module Inventory

This repo implements five cross-cutting epics:

| Epic | Module | Route Prefix | Status | Tables |
|---|---|---|---|---|
| XCT-1 | CRM | `/api/crm` | Functional | `crm_contacts`, `crm_deals`, `crm_activities`, `crm_pipeline_stages` |
| XCT-2 | HRM | `/api/hrm` | Partial (payroll/attendance are stubs) | `hrm_employees`, `hrm_leave_requests` |
| XCT-3 | Ticketing | `/api/ticketing` | Functional | `tickets`, `ticket_comments`, `ticket_workflows` |
| XCT-4 | Chat | `/api/chat` | Functional (polling only, no real-time) | `chat_conversations`, `chat_messages` |
| XCT-5 | Analytics | `/api/analytics` | Functional (no aggregation pipeline) | `analytics_events`, `analytics_daily_metrics`, `analytics_monthly_aggregates`, `analytics_insights` |

### 1.3 Middleware Stack

```
ALL ROUTES     → tenantMiddleware    (extracts x-tenant-id header)
/api/*         → authMiddleware      (verifies Bearer JWT via @webwaka/core verifyJWT)
```

**Critical Gap:** The auth middleware uses `verifyJWT` from `@webwaka/core` correctly, but the `tenantId` is sourced from the `x-tenant-id` request header, NOT from the verified JWT payload. This violates the core platform invariant: `"tenantId ALWAYS sourced from validated JWT payload, NEVER from request headers."` (See `@webwaka/core/auth` module docs.)

### 1.4 Dependencies

| Package | Version | Role |
|---|---|---|
| `@webwaka/core` | ^1.6.1 | Auth (JWT), RBAC, Logger, Events, AI, Notifications |
| `hono` | ^4.0.0 | HTTP framework |
| `zod` | ^3.23.8 | Runtime validation |
| `dexie` | latest | Required by `@webwaka/core` offline queue |
| `wrangler` | ^3.93.0 | Dev/deploy CLI |
| `vitest` | ^1.6.0 | Unit testing |
| `typescript` | ^5.4.5 | Compiler |
| `@cloudflare/workers-types` | ^4.20241230.0 | Type definitions |

### 1.5 Database Schema Deep Analysis

**Migration 001 — Initial Schema:**
- `crm_contacts`: Soft-delete via `deleted_at`. Good. Indexed by `tenant_id` and `(tenant_id, stage)`.
- `crm_deals`: Hard-delete risk. No `deleted_at` column. Pipeline stage changes are destructive.
- `hrm_employees`: No soft-delete (hard "termination" sets `status = 'terminated'`). No audit trail.
- `hrm_leave_requests`: No `updated_at` column. Status changes are untracked in time.
- `tickets`: Hard-deletes allowed in API despite `resolved_at` tracking. No SLA deadline column.
- `ticket_comments`: No soft-delete. Comments cannot be edited.
- `chat_conversations`: `participants` stored as JSON string, not normalized.
- `chat_messages`: No `edited_at`, no `deleted_at`. Messages cannot be edited or retracted.

**Migration 002 — Analytics:**
- `analytics_events`: `event_data` is raw JSON string. No schema enforcement at DB level.
- `analytics_daily_metrics`: UNIQUE constraint on `(tenant_id, vertical, metric_date)` — good for upserts.
- `analytics_insights`: `expires_at` used for TTL — smart. No index on `expires_at` for cleanup.

**Migration 003 — CRM Enhancements:**
- `crm_activities`: Well indexed. Cascading deletes on contact/deal removal — correct.
- `crm_pipeline_stages`: Default stages inserted for `tenant_id = 'default'`. Query in `pipeline` endpoint uses `OR tenant_id = 'default'` — this is a potential data-leak if not carefully scoped.

**Migration 004 — Ticketing Enhancements:**
- `ticket_workflows`: Workflow rules stored but NEVER EXECUTED. The `// TODO: Emit event to event bus, apply workflow rules` comment in `ticketing/api.ts` confirms this. Workflow rules are dead code.

### 1.6 Current Bugs and Critical Issues

1. **BUG-001:** `tenantId` sourced from `x-tenant-id` header, not JWT — tenant spoofing risk.
2. **BUG-002:** `analytics/api.ts` line 76–78: SQL string interpolation using template literals (`${dateFilter}`) — SQL injection vector.
3. **BUG-003:** `analytics/api.ts` line 140: Same SQL injection pattern in the revenue endpoint.
4. **BUG-004:** `analytics/api.ts` line 192: Same SQL injection pattern in the growth endpoint.
5. **BUG-005:** `crm/api.ts` count query doesn't apply stage/search filters, returning wrong total when filtered.
6. **BUG-006:** `hrm/api.ts` count query also missing department/status/search filters.
7. **BUG-007:** `ticketing/api.ts` count query missing status/priority/assigned_to/search filters.
8. **BUG-008:** Ticket hard-delete (`DELETE FROM tickets`) destroys associated comments — no cascade defined.
9. **BUG-009:** `generateId()` is duplicated in EVERY module file instead of being imported from `@webwaka/core/nanoid`.
10. **BUG-010:** `koboToNaira()` is duplicated in every module — should use shared utility.
11. **BUG-011:** All `console.error()` calls violate the platform's "Zero Console Logs" rule — must use `@webwaka/core` logger.
12. **BUG-012:** `analytics/api.test.ts` renamed to `.bak` — tests are excluded from CI. Zero active test coverage.
13. **BUG-013:** Ticket workflow rules are defined and stored but never evaluated or executed.
14. **BUG-014:** `chat/api.ts` — posting a message to a conversation does NOT verify the conversation belongs to the tenant.
15. **BUG-015:** `hrm_leave_requests` table has no `updated_at` column but the PATCH endpoint silently omits tracking the update time.
16. **BUG-016:** `crm_pipeline_stages` default stage data uses `tenant_id = 'default'` which could leak to other tenants if query is incorrect.
17. **BUG-017:** `analytics/api.ts` insight health check calls `AI_PLATFORM_URL/health` without timeout — will block the worker if AI platform is slow.

### 1.7 CI/CD Setup

- **File:** `.github/workflows/ci.yml`
- **Triggers:** Push to `main`, PRs to `main`
- **Steps:** Check `@webwaka/core >= 1.6.0`, `npm ci`, `typecheck`, `npm test`
- **Gap:** No deploy step (wrangler deploy not in CI — must be manual)
- **Gap:** No linting step (`eslint` is in `package.json` scripts but absent from CI)
- **Gap:** No secret scanning
- **Gap:** No staging deploy gate before production

### 1.8 What Lives Elsewhere in the WebWaka Ecosystem

| Capability | Location |
|---|---|
| JWT signing (login) | `webwaka-super-admin-v2` or `webwaka-core-auth` repo |
| AI inference / LLM calls | `webwaka-ai-platform` (called via `AI_PLATFORM_URL`) |
| Event bus wiring (Cloudflare Queues) | `webwaka-core` or platform infra repo |
| Tenant provisioning | `webwaka-super-admin-v2` |
| Notification delivery (email, SMS, push) | `@webwaka/core` notifications module |
| Billing / subscription management | `@webwaka/core` billing module |
| RBAC role definitions | `@webwaka/core/rbac` (Role enum) |
| KYC verification | `@webwaka/core/kyc` |
| R2 file storage | Platform infra (not yet wired in this repo) |

---

## 2. EXTERNAL BEST-PRACTICE RESEARCH

### 2.1 CRM Systems — World-Class Standards

**Leading products:** Salesforce, HubSpot, Pipedrive, Zoho CRM

**Standards identified:**
- **Idempotency keys** on all write endpoints (POST, PATCH) to prevent duplicate submissions on retry.
- **Webhook delivery** on stage transitions — every pipeline move emits an event.
- **Custom fields** (schema extensibility) — tenants define their own attributes on contacts and deals.
- **Lead scoring** — automated numeric score based on activities, profile completeness, engagement.
- **Activity timeline** — rich chronological view of all touchpoints per contact.
- **Duplicate detection** — email/phone deduplication before creating a contact.
- **Import/export** — CSV/XLSX bulk operations.
- **Bulk operations API** — batch create/update for imports from legacy systems.

### 2.2 HRM Systems — World-Class Standards

**Leading products:** BambooHR, Workday, Gusto (US), Sage HR

**Africa/Nigeria-specific standards:**
- **PAYE calculation** — Progressive tax bands per Federal Inland Revenue Service (FIRS) Nigeria.
- **Pension deduction** — 8% employee + 10% employer (PENCOM Act 2004, amended).
- **NHF** — 2.5% of basic salary (National Housing Fund Act).
- **NSITF** — 1% of total monthly payroll (National Social Insurance Trust Fund).
- **Annual leave entitlement** — Minimum 6 working days (Labour Act Nigeria), industry standard is 20-30 days.
- **Payslip generation** — PDF with statutory breakdown, company branding, employee ID.
- **Multi-bank disbursement** — Payroll payments via Nigerian bank APIs (Paystack, Flutterwave, Monnify).
- **Employee self-service** — Leave requests, payslip downloads (typically via a separate frontend).
- **Time & Attendance** — Clock-in/clock-out with geofencing for field staff.

### 2.3 Support Ticketing — World-Class Standards

**Leading products:** Zendesk, Freshdesk, Intercom, Help Scout

**Standards identified:**
- **SLA policies** — First response time, resolution time by priority (e.g., Critical: 1h response, 4h resolution).
- **SLA breach alerts** — Proactive escalation before and after breach.
- **CSAT (Customer Satisfaction)** — Post-resolution survey sent to requester.
- **Multi-channel ingestion** — Email, WhatsApp, web widget, API, Telegram (already in schema).
- **Canned responses / macros** — Pre-written reply templates for common issues.
- **Agent collision detection** — Prevent two agents from responding to the same ticket simultaneously.
- **Merge tickets** — Combine duplicate tickets from the same requester.
- **Ticket splitting** — Break a multi-issue ticket into child tickets.
- **Report: MTTR (Mean Time To Resolution)** — Core KPI for support ops.
- **WhatsApp integration** — In Nigeria, >80% of customer service touchpoints are WhatsApp-first.

### 2.4 Chat Systems — World-Class Standards

**Leading products:** Slack, Intercom Messenger, Crisp, Chatwoot (open-source)

**Standards identified:**
- **Real-time delivery** — WebSocket or Cloudflare Durable Objects for stateful connections.
- **Message delivery status** — Sent → Delivered → Read (triple-state).
- **Typing indicators** — Ephemeral state via Durable Objects.
- **Message reactions** — Emoji reactions.
- **Thread support** — Reply-in-thread.
- **Media messages** — Images, files, voice notes.
- **Bot/AI integration** — Auto-reply bots for after-hours coverage.
- **Conversation routing** — Round-robin or skill-based assignment of live chats to agents.
- **Offline queueing** — Dexie/IndexedDB to queue messages when offline, sync on reconnect.

### 2.5 Analytics Platforms — World-Class Standards

**Leading products:** Mixpanel, Amplitude, Metabase, Grafana, Cloudflare Analytics Engine

**Standards identified:**
- **Event schema governance** — All events must have `event_type`, `tenant_id`, `user_id`, `session_id`, `timestamp`, `properties` (typed).
- **Funnel analysis** — Conversion tracking through multi-step flows.
- **Cohort analysis** — Group users by acquisition date, analyze retention.
- **Real-time dashboards** — Sub-second aggregations using Cloudflare Workers Analytics Engine (native).
- **Dimensional drilling** — Filter by vertical, date range, geography, plan tier.
- **Alerting** — Threshold-based alerts when KPIs drop below/above configured levels.
- **Export** — CSV/JSON data export for BI tools.
- **AI narrative summaries** — Weekly/monthly auto-generated written summaries of performance.

### 2.6 Cloudflare Workers / Edge Architecture Best Practices

- **Never use `console.log`** — use platform logger (structured JSON logs via `wrangler tail`).
- **Durable Objects** for stateful real-time features (chat, presence).
- **Cloudflare Queues** for async event processing (replaces `// TODO: Emit event`).
- **R2** for large blob storage (documents, media).
- **D1 WAL mode** — already set in migrations (good).
- **Workers Analytics Engine** — native real-time analytics without D1.
- **Tail Workers** — for centralized logging and observability.
- **Rate limiting with KV** — sliding window pattern already available in `@webwaka/core/auth`.
- **D1 batch operations** — Use `DB.batch([])` for atomic multi-statement writes.
- **Response caching with Cache API** — Cache read-heavy endpoints (pipeline summary, analytics).

### 2.7 Nigeria-First / Africa-Ready Standards

- **NGN currency** — Always store as kobo (integer). Already done well in this repo.
- **WhatsApp Business API** — Primary communication channel. Must be a first-class integration.
- **SMS fallback** — For non-smartphone users (available in `@webwaka/core` notifications).
- **Low-bandwidth optimization** — Paginated responses (already done), delta sync for offline-first.
- **NDPR compliance** — Nigeria Data Protection Regulation. Data minimization, right to erasure, consent management.
- **Local time zones** — Africa/Lagos (WAT, UTC+1) for all timestamp display and SLA calculations.
- **Multi-currency payroll** — Expatriate employees may be paid in USD; NGN conversion on payslip.

---

## 3. SYNTHESIS AND GAP ANALYSIS

### 3.1 Implemented vs. Missing

| Capability | Implemented | Missing / Incomplete |
|---|---|---|
| Contact CRUD | ✅ | Duplicate detection, custom fields, bulk import |
| Deal pipeline | ✅ | Pipeline automation, deal soft-delete |
| CRM activities | ✅ | Recurring tasks, activity templates |
| Employee CRUD | ✅ | Document vault, org chart |
| Leave management | ✅ | Leave balance tracking, holiday calendar |
| Payroll | ❌ | Entire Nigerian payroll engine |
| Attendance | ❌ | Clock-in/out, geofencing |
| Ticketing | ✅ | SLA engine, CSAT, WhatsApp bridge |
| Workflow rules | ⚠️ Schema only, never executed | Actual execution engine |
| Chat | ✅ (polling) | Real-time (Durable Objects), media, typing |
| Analytics events | ✅ | Batch ingestion, strict schema |
| Analytics aggregation | ⚠️ Manual queries | Auto-aggregation pipeline |
| AI insights | ⚠️ DB read only | Actual AI-triggered generation |
| Event bus integration | ❌ | All events are TODO stubs |
| Rate limiting | ❌ | No rate limits on any endpoint |
| Audit logging | ❌ | No audit trail |
| RBAC | ❌ | Auth middleware validates JWT but no role enforcement |
| Idempotency | ❌ | No idempotency keys |
| Soft deletes (all modules) | ⚠️ CRM contacts only | Deals, tickets, employees |
| Tests | ❌ | Test file renamed to .bak |

### 3.2 Architecture Gaps

1. **Event bus is entirely missing** — all 20+ `// TODO: Emit event to event bus` stubs are dead code.
2. **tenantId is sourced from header** — violates core platform security model.
3. **No RBAC** — any authenticated user can delete any record in any module.
4. **No rate limiting** — API is open to abuse.
5. **SQL injection** — three analytics endpoints use unsafe string interpolation.
6. **No audit trail** — impossible to know who changed what and when.
7. **No idempotency** — retried requests create duplicate records.
8. **Chat has no real-time mechanism** — polling is not viable at scale.

---

## 4. TOP 20 ENHANCEMENTS

| # | Enhancement | Category | Priority |
|---|---|---|---|
| E01 | Fix `tenantId` to be JWT-sourced (not header) | Security / Bug | P0 |
| E02 | Fix SQL injection in analytics module | Security / Bug | P0 |
| E03 | Implement event bus emissions (replace all TODO stubs) | Architecture | P0 |
| E04 | Implement Nigerian Payroll Engine (PAYE, Pension, NHF, NSITF) | HRM | P1 |
| E05 | Implement ticketing SLA engine with breach alerts | Ticketing | P1 |
| E06 | Implement RBAC middleware on all write endpoints | Security | P1 |
| E07 | Add rate limiting to all API endpoints | Security | P1 |
| E08 | Build Audit Log system (global_audit_logs table + middleware) | Compliance | P1 |
| E09 | Execute ticket workflow rules (trigger + action engine) | Ticketing | P1 |
| E10 | Migrate to `@webwaka/core` logger (replace all console.log/error) | Compliance | P1 |
| E11 | Fix pagination count queries (apply same filters as list query) | Bug | P1 |
| E12 | Restore and expand unit test suite (rename .bak, add all modules) | Quality | P1 |
| E13 | Add idempotency key support to all write endpoints | Reliability | P2 |
| E14 | Add soft delete to deals, tickets, employees | Data Integrity | P2 |
| E15 | Add delta-sync endpoints for offline-first clients | PWA/Offline | P2 |
| E16 | Add CRM custom fields engine | CRM | P2 |
| E17 | WhatsApp Bridge for Ticketing (inbound webhook handler) | Integration | P2 |
| E18 | Real-time Chat via Cloudflare Durable Objects | Chat | P2 |
| E19 | Attendance tracking module (clock-in/out, geofencing) | HRM | P2 |
| E20 | Add CI linting, staging deploy gate, and coverage check | DevOps | P2 |

---

## 5. BUG FIX RECOMMENDATIONS

| Bug ID | Description | Severity | File | Fix |
|---|---|---|---|---|
| BUG-001 | `tenantId` sourced from header not JWT | Critical | `middleware/tenant.ts`, `middleware/auth.ts` | Extract from `c.get("jwtPayload").tenantId` |
| BUG-002 | SQL injection via template literal in analytics summary | Critical | `analytics/api.ts:76` | Use parameterized queries |
| BUG-003 | SQL injection in analytics revenue endpoint | Critical | `analytics/api.ts:140` | Use parameterized queries |
| BUG-004 | SQL injection in analytics growth endpoint | Critical | `analytics/api.ts:192` | Use parameterized queries |
| BUG-005 | CRM contact count ignores stage/search filters | High | `crm/api.ts:117` | Apply same WHERE clauses to count query |
| BUG-006 | HRM employee count ignores dept/status/search filters | High | `hrm/api.ts:112` | Apply same WHERE clauses to count query |
| BUG-007 | Ticket count ignores all filters | High | `ticketing/api.ts:113` | Apply same WHERE clauses to count query |
| BUG-008 | Ticket hard-delete cascades without constraint | High | `migrations/001` | Add `ON DELETE CASCADE` to `ticket_comments` |
| BUG-009 | `generateId()` duplicated in all 5 modules | Medium | All `api.ts` files | Import from `@webwaka/core/nanoid` |
| BUG-010 | `koboToNaira()` duplicated in all modules | Medium | All `api.ts` files | Import from `@webwaka/core` billing utils |
| BUG-011 | All `console.error()` calls violate platform standard | Medium | All `api.ts` files | Replace with `@webwaka/core` logger |
| BUG-012 | `api.test.ts.bak` excluded from CI — zero test coverage | High | `analytics/` | Rename to `.test.ts`, add to CI |
| BUG-013 | Ticket workflow rules stored but never executed | High | `ticketing/api.ts` | Build workflow execution engine |
| BUG-014 | Chat message posting doesn't verify conversation tenant | High | `chat/api.ts:211` | Add tenant check before insert |
| BUG-015 | `hrm_leave_requests` has no `updated_at` tracking | Medium | `migrations/001` | Add migration to add column |
| BUG-016 | Pipeline default stages can leak across tenants | Medium | `crm/api.ts:464` | Scope query strictly; seed per-tenant on onboarding |
| BUG-017 | AI platform health check has no timeout — will block worker | Medium | `analytics/api.ts:321` | Add `signal: AbortSignal.timeout(3000)` |

---

## 6. TASK BREAKDOWN

---

### T01 — Fix tenantId Security Vulnerability (BUG-001)
**Phase:** Phase 1
**Priority:** P0 — Critical

**Objective:** Ensure `tenantId` is always extracted from the validated JWT payload, never from the `x-tenant-id` request header.

**Why it matters:** The current implementation allows any client to spoof any tenant's identity by setting the `x-tenant-id` header. This is an existential data-isolation bug in a multi-tenant platform.

**Repo scope:** `webwaka-cross-cutting`

**Dependencies:** `@webwaka/core` v1.6.1+ (provides `jwtAuthMiddleware` and `JWTPayload.tenantId`)

**Prerequisites:** JWT tokens must include `tenantId` in their payload — verify with `webwaka-super-admin-v2` or auth service.

**Impacted modules:** All 5 modules + middleware layer

**Files to change:**
- `src/middleware/tenant.ts` — remove or repurpose to be header validation only (not source of tenantId)
- `src/middleware/auth.ts` — after JWT verification, extract `tenantId` from payload and set it in context
- `src/worker.ts` — reorder middleware if needed

**Expected output:** `c.get("tenantId")` is always sourced from a verified JWT claim.

**Acceptance criteria:**
- Requests without a valid JWT are rejected at auth middleware
- Requests with a valid JWT where `tenantId` mismatches x-tenant-id header are still processed using the JWT value
- No module can be accessed with an arbitrary tenant ID
- TypeScript compiles with no errors
- Existing tests pass

**Tests required:**
- Unit test: JWT with tenantId A, header with tenantId B → operations apply to A
- Unit test: No JWT → 401
- Unit test: Expired JWT → 401

**Risks:** Public health endpoint (`/health`) must remain unauthenticated; only `/api/*` routes need JWT tenantId.

**Governance documents:** `@webwaka/core/auth` module docs; Blueprint Part 2 Layer 4.

**Reminders:** Build Once Use Infinitely — use `jwtAuthMiddleware` from `@webwaka/core`, do NOT write a new JWT extractor.

---

### T02 — Fix SQL Injection in Analytics Module (BUG-002/003/004)
**Phase:** Phase 1
**Priority:** P0 — Critical

**Objective:** Eliminate all SQL string interpolation in `src/modules/analytics/api.ts` using parameterized D1 queries.

**Why it matters:** The `vertical` filter is interpolated directly into SQL strings via template literals, allowing a malicious tenant to inject arbitrary SQL.

**Impacted files:**
- `src/modules/analytics/api.ts` — lines ~76, ~140, ~192

**Fix pattern:**
```typescript
// BEFORE (vulnerable):
const dateFilter = query.vertical
  ? `AND vertical = '${query.vertical}'`
  : "";
// ...
.bind(tenantId, start)

// AFTER (safe):
const params: any[] = [tenantId, start];
let verticalFilter = "";
if (query.vertical) {
  verticalFilter = "AND vertical = ?";
  params.push(query.vertical);
}
// ...
.bind(...params)
```

**Acceptance criteria:** No raw string interpolation of user input into SQL. All inputs bound as parameters.

**Tests required:** Test with `vertical=commerce'; DROP TABLE analytics_events; --` — must return 400 (Zod enum validation) or execute safely.

---

### T03 — Fix Pagination Count Query Bugs (BUG-005/006/007)
**Phase:** Phase 1
**Priority:** P1

**Objective:** Ensure count queries in CRM contacts, HRM employees, and Ticketing apply the same WHERE clauses as their corresponding list queries.

**Why it matters:** `pagination.total` is wrong whenever filters are applied, causing clients to show incorrect "X of Y results" and wrong page numbers.

**Files to change:**
- `src/modules/crm/api.ts` — contacts list count query
- `src/modules/hrm/api.ts` — employees list count query
- `src/modules/ticketing/api.ts` — tickets list count query

**Pattern:** Build count query params using the same logic as the list query params (extract filter-building into a helper function).

**Acceptance criteria:** `pagination.total` matches actual filtered result count in all cases.

**Tests required:** Create 10 contacts; filter by stage "lead" (5 results); verify `total = 5` and `pages = 1`.

---

### T04 — Restore and Expand Test Suite (BUG-012)
**Phase:** Phase 1
**Priority:** P1

**Objective:** Rename `api.test.ts.bak` to `api.test.ts` and add unit tests for all 5 modules.

**Why it matters:** CI runs `npm test` but there are zero active test files. The test step always passes vacuously, providing false confidence.

**Files to create/modify:**
- `src/modules/analytics/api.test.ts` (rename from .bak)
- `src/modules/crm/api.test.ts` (new)
- `src/modules/hrm/api.test.ts` (new)
- `src/modules/ticketing/api.test.ts` (new)
- `src/modules/chat/api.test.ts` (new)

**Each test file must cover:**
- GET index (module info)
- POST create (valid payload → 201)
- POST create (invalid payload → 400 with Zod errors)
- GET list (returns array with pagination)
- GET single (existing id → 200; non-existing → 404)
- PATCH update (partial update → 200)
- DELETE (existing → 200; non-existing → 404)
- Unauthorized access (no tenantId → 401)

**Tests required:** Minimum 8 tests per module = 40 tests total.

**Acceptance criteria:** `npm test` runs at least 40 tests and all pass.

---

### T05 — Replace console.log/error with @webwaka/core Logger (BUG-011)
**Phase:** Phase 1
**Priority:** P1

**Objective:** Replace all `console.error()` calls across all module files with the platform logger from `@webwaka/core`.

**Why it matters:** The platform has a "Zero Console Logs" invariant. Structured logging is required for production observability via `wrangler tail`.

**Import pattern:**
```typescript
import { logger } from "@webwaka/core";

// Usage:
logger.error("Contacts list error", { tenantId }, error);
logger.info("Contact created", { tenantId, contactId });
```

**Files to change:** All 5 `src/modules/*/api.ts` files.

**Acceptance criteria:** Zero `console.log`, `console.warn`, or `console.error` calls in any module file.

---

### T06 — Deduplicate generateId() and koboToNaira() (BUG-009/010)
**Phase:** Phase 1
**Priority:** P1

**Objective:** Remove the `generateId()` and `koboToNaira()` helper functions from all 5 module files and import them from `@webwaka/core`.

**Why it matters:** DRY principle. Duplicated helpers drift over time. `@webwaka/core/nanoid` already provides ID generation.

**Import pattern:**
```typescript
import { generateNanoId } from "@webwaka/core/nanoid";
// Use: const id = `contact-${generateNanoId()}`;
```

**For koboToNaira:** Check `@webwaka/core` billing utils — if not exported, add to core or create a shared util in this repo at `src/utils/currency.ts`.

**Files to change:** `src/modules/crm/api.ts`, `hrm/api.ts`, `ticketing/api.ts`, `chat/api.ts`, `analytics/api.ts`.

---

### T07 — Implement Event Bus Emissions (E03)
**Phase:** Phase 1
**Priority:** P0

**Objective:** Replace all `// TODO: Emit event to event bus` stubs with real typed event emissions using `@webwaka/core` event primitives and Cloudflare Queues.

**Why it matters:** The entire WebWaka platform is event-driven. No direct inter-DB access is allowed. Currently, ALL cross-module notifications, analytics aggregation triggers, and workflow automations are broken because events are never emitted.

**Architecture:**
1. Add a Cloudflare Queue binding to `wrangler.toml` for development (`xct_events`)
2. Create `src/utils/eventEmitter.ts` — wraps the Queue send with typed payloads from `WebWakaEventType` enum
3. In each mutation endpoint, after the DB write, call `await emitEvent(env, { type, tenantId, payload })`

**New event types needed (add to @webwaka/core or document for cross-repo addition):**
- `xct.crm.contact.created`, `xct.crm.contact.updated`, `xct.crm.contact.deleted`
- `xct.crm.deal.created`, `xct.crm.deal.stage_changed`
- `xct.hrm.employee.created`, `xct.hrm.leave.requested`, `xct.hrm.leave.approved`
- `xct.ticketing.ticket.created`, `xct.ticketing.ticket.resolved`, `xct.ticketing.ticket.assigned`
- `xct.chat.message.sent`

**Expected output:** Every mutation emits a typed event. Queue consumer can aggregate analytics or trigger notifications.

**Acceptance criteria:**
- All `// TODO: Emit event` comments removed
- Queue binding configured in `wrangler.toml`
- Typed event payloads match `@webwaka/core` event contracts
- If queue send fails, it does NOT fail the user-facing request (non-blocking, fire-and-forget pattern)

---

### T08 — Implement RBAC on Write Endpoints (E06)
**Phase:** Phase 1
**Priority:** P1

**Objective:** Apply `requireRole` and `requirePermissions` middleware from `@webwaka/core/rbac` to all state-changing endpoints.

**Why it matters:** Currently, any authenticated user (even `Role.CUSTOMER`) can delete employees, close tickets, or update deals. There is no role enforcement.

**Role matrix:**
| Endpoint type | Required role |
|---|---|
| GET (read) | STAFF, TENANT_ADMIN |
| POST (create) | STAFF, TENANT_ADMIN |
| PATCH (update) | STAFF, TENANT_ADMIN |
| DELETE (delete) | TENANT_ADMIN only |
| Payroll operations | TENANT_ADMIN only |
| Leave approval | TENANT_ADMIN, STAFF (manager) |
| Workflow rule management | TENANT_ADMIN only |

**Import pattern:**
```typescript
import { requireRole, Role } from "@webwaka/core/rbac";
// Route-level:
crmRouter.delete("/contacts/:id", requireRole([Role.TENANT_ADMIN]), async (c) => { ... });
```

**Files to change:** All 5 module routers.

---

### T09 — Implement Rate Limiting (E07)
**Phase:** Phase 1
**Priority:** P1

**Objective:** Add rate limiting middleware to all API endpoints using `rateLimit` from `@webwaka/core/auth`.

**Why it matters:** Without rate limiting, a single tenant or bad actor can exhaust D1 read units or spam the system.

**Configuration:**
- Standard endpoints: 100 requests/minute per tenant
- Write endpoints: 30 requests/minute per tenant
- Analytics ingestion: 500 events/minute per tenant (higher for telemetry)

**Implementation:**
```typescript
import { rateLimit } from "@webwaka/core/auth";
// Apply in worker.ts globally:
app.use("/api/*", rateLimit({ windowMs: 60000, max: 100, kvNamespace: env.SESSIONS_KV }));
```

**Files to change:** `src/worker.ts`, `wrangler.toml` (ensure SESSIONS_KV is available in dev).

---

### T10 — Implement Audit Log System (E08)
**Phase:** Phase 1
**Priority:** P1

**Objective:** Create a `global_audit_logs` table and a Hono middleware that captures every state-changing request with actor, action, entity, old state, and new state.

**Why it matters:** NDPR compliance requires an audit trail. Operations teams need it for debugging. Security teams need it for incident response.

**Migration (add as migration 005):**
```sql
CREATE TABLE IF NOT EXISTS global_audit_logs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,           -- CREATE, UPDATE, DELETE
  entity_type TEXT NOT NULL,      -- crm_contact, ticket, employee, etc.
  entity_id TEXT NOT NULL,
  old_data TEXT,                  -- JSON snapshot before change
  new_data TEXT,                  -- JSON snapshot after change
  ip_address TEXT,
  user_agent TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000)
);
CREATE INDEX IF NOT EXISTS idx_audit_tenant ON global_audit_logs(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON global_audit_logs(entity_type, entity_id);
```

**Middleware (`src/middleware/audit.ts`):**
- Intercept all POST, PATCH, DELETE requests
- Capture request body (new_data), fetch current state from DB (old_data)
- Write to `global_audit_logs` asynchronously (non-blocking)

**API endpoint:** `GET /api/audit-logs?entity_type=&entity_id=&page=` (TENANT_ADMIN only)

---

### T11 — Fix Chat Tenant Isolation Bug (BUG-014)
**Phase:** Phase 1
**Priority:** P1

**Objective:** Add tenant ownership verification before inserting messages into conversations.

**File:** `src/modules/chat/api.ts`

**Fix:**
```typescript
// Before inserting message, verify conversation belongs to tenant:
const conv = await c.env.DB.prepare(
  "SELECT id FROM chat_conversations WHERE id = ? AND tenant_id = ?"
).bind(conversationId, tenantId).first();
if (!conv) return c.json({ error: "Conversation not found" }, 404);
```

---

### T12 — Implement Nigerian Payroll Engine — Phase 1 (E04)
**Phase:** Phase 1
**Priority:** P1

**Objective:** Implement the payroll calculation engine with Nigerian statutory deductions: PAYE, Pension, NHF, NSITF.

**Why it matters:** This is a core HRM feature. Without payroll, the HRM module is incomplete and cannot be used by any Nigerian business.

**Files to create:**
- `src/modules/hrm/payroll.ts` — calculation engine
- `src/modules/hrm/payrollRoutes.ts` — API routes

**New DB tables (migration 006):**
```sql
CREATE TABLE IF NOT EXISTS hrm_payroll_runs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  period_month TEXT NOT NULL,     -- YYYY-MM
  status TEXT NOT NULL DEFAULT 'draft',  -- draft, approved, paid
  total_gross_kobo INTEGER NOT NULL DEFAULT 0,
  total_net_kobo INTEGER NOT NULL DEFAULT 0,
  total_paye_kobo INTEGER NOT NULL DEFAULT 0,
  total_pension_kobo INTEGER NOT NULL DEFAULT 0,
  total_nhf_kobo INTEGER NOT NULL DEFAULT 0,
  total_nsitf_kobo INTEGER NOT NULL DEFAULT 0,
  processed_by TEXT,
  approved_by TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()*1000),
  UNIQUE(tenant_id, period_month)
);

CREATE TABLE IF NOT EXISTS hrm_payslips (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  payroll_run_id TEXT NOT NULL REFERENCES hrm_payroll_runs(id),
  employee_id TEXT NOT NULL REFERENCES hrm_employees(id),
  gross_kobo INTEGER NOT NULL,
  paye_kobo INTEGER NOT NULL DEFAULT 0,
  pension_employee_kobo INTEGER NOT NULL DEFAULT 0,
  pension_employer_kobo INTEGER NOT NULL DEFAULT 0,
  nhf_kobo INTEGER NOT NULL DEFAULT 0,
  nsitf_kobo INTEGER NOT NULL DEFAULT 0,
  net_kobo INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000)
);
```

**Nigerian PAYE bands (2024 FIRS):**
```
First ₦300,000: 7%
Next ₦300,000: 11%
Next ₦500,000: 15%
Next ₦500,000: 19%
Next ₦1,600,000: 21%
Above ₦3,200,000: 24%
```

**Calculation logic:**
- Gross = `salary_kobo`
- Consolidated Relief Allowance = 200,000 + 20% of gross (annual)
- Taxable income = Gross - CRA
- Apply PAYE bands to taxable income
- Pension: 8% employee contribution (of basic salary)
- NHF: 2.5% of basic salary
- NSITF: 1% employer contribution
- Net = Gross - PAYE - Pension(employee) - NHF

**API routes:**
- `POST /api/hrm/payroll/run` — Create draft payroll run for a period
- `GET /api/hrm/payroll/runs` — List payroll runs
- `GET /api/hrm/payroll/runs/:id` — Get single run with payslips
- `PATCH /api/hrm/payroll/runs/:id/approve` — Approve run (TENANT_ADMIN)
- `GET /api/hrm/payslips/:id` — Get individual payslip (with PDF generation stub)

---

### T13 — Implement Ticketing SLA Engine (E05)
**Phase:** Phase 1**Priority:** P1

**Objective:** Build an SLA tracking system that records deadlines, detects breaches, and emits escalation events.

**SLA Defaults (by priority):**
| Priority | First Response | Resolution |
|---|---|---|
| Critical | 1 hour | 4 hours |
| High | 4 hours | 24 hours |
| Medium | 8 hours | 72 hours |
| Low | 24 hours | 168 hours |

**Migration (add as part of 007):**
```sql
ALTER TABLE tickets ADD COLUMN first_response_due INTEGER;
ALTER TABLE tickets ADD COLUMN resolution_due INTEGER;
ALTER TABLE tickets ADD COLUMN first_responded_at INTEGER;
ALTER TABLE tickets ADD COLUMN sla_breached INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS sla_policies (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  priority TEXT NOT NULL,
  first_response_minutes INTEGER NOT NULL,
  resolution_minutes INTEGER NOT NULL,
  business_hours_only INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000),
  UNIQUE(tenant_id, priority)
);
```

**Logic:** When a ticket is created, calculate `first_response_due` and `resolution_due` based on SLA policy (or defaults). On first agent comment, set `first_responded_at`. A Cloudflare Cron Trigger checks for breaches every 15 minutes and emits events.

**New API routes:**
- `GET /api/ticketing/sla-policies` — List SLA policies
- `POST /api/ticketing/sla-policies` — Create/update SLA policy
- `GET /api/ticketing/sla-report` — Breach stats and MTTR

---

### T14 — Implement Ticket Workflow Execution Engine (BUG-013, E09)
**Phase:** Phase 1
**Priority:** P1

**Objective:** Build the actual workflow rule evaluation engine so that stored `ticket_workflows` rules are executed when tickets are created or updated.

**Engine logic:**
```typescript
async function evaluateWorkflows(env: Env, tenantId: string, ticket: Ticket, triggerType: string, triggerValue: string) {
  const rules = await env.DB.prepare(
    "SELECT * FROM ticket_workflows WHERE tenant_id = ? AND trigger_type = ? AND trigger_value = ? AND is_active = 1"
  ).bind(tenantId, triggerType, triggerValue).all();

  for (const rule of rules.results as any[]) {
    switch (rule.action_type) {
      case "assign_to":
        await env.DB.prepare("UPDATE tickets SET assigned_to = ? WHERE id = ?").bind(rule.action_value, ticket.id).run();
        break;
      case "set_status":
        await env.DB.prepare("UPDATE tickets SET status = ? WHERE id = ?").bind(rule.action_value, ticket.id).run();
        break;
      case "set_priority":
        await env.DB.prepare("UPDATE tickets SET priority = ? WHERE id = ?").bind(rule.action_value, ticket.id).run();
        break;
      case "send_notification":
        // Emit event for notification service
        break;
    }
  }
}
```

**Call points:** After ticket create (trigger: `new_ticket`), after ticket patch for status change (trigger: `status_change`), priority change (trigger: `priority_change`).

---

### T15 — Add Soft Delete to Deals, Tickets, and Employees (E14)
**Phase:** Phase 1
**Priority:** P1

**Objective:** Replace hard deletes with soft deletes across all remaining modules.

**Migration (008):**
```sql
ALTER TABLE crm_deals ADD COLUMN deleted_at INTEGER;
ALTER TABLE tickets ADD COLUMN deleted_at INTEGER;
-- hrm_employees already soft-deletes via status change, enhance it:
ALTER TABLE hrm_employees ADD COLUMN deleted_at INTEGER;
```

**Code changes:** Update DELETE handlers to `SET deleted_at = ?`, update all SELECT queries to add `AND deleted_at IS NULL`.

---

### T16 — Add `updated_at` to hrm_leave_requests (BUG-015)
**Phase:** Phase 1
**Priority:** P1

**Migration (009):**
```sql
ALTER TABLE hrm_leave_requests ADD COLUMN updated_at INTEGER;
UPDATE hrm_leave_requests SET updated_at = created_at WHERE updated_at IS NULL;
```

**Code change:** PATCH leave handler must set `updated_at = ?`.

---

### T17 — Fix AI Platform Health Check Timeout (BUG-017)
**Phase:** Phase 1
**Priority:** P1

**File:** `src/modules/analytics/api.ts`

**Fix:**
```typescript
const response = await fetch(`${c.env.AI_PLATFORM_URL}/health`, {
  headers: { Authorization: `Bearer ${c.env.AI_PLATFORM_TOKEN}` },
  signal: AbortSignal.timeout(3000), // 3 second timeout
});
```

---

### T18 — Add Idempotency Key Support (E13)
**Phase:** Phase 2
**Priority:** P2

**Objective:** Accept an `Idempotency-Key` header on all POST endpoints and deduplicate requests using KV storage.

**Implementation:**
1. Middleware checks for `Idempotency-Key` header
2. Key stored in `SESSIONS_KV` as `idempotency:{tenantId}:{key}` → cached response JSON
3. TTL: 24 hours
4. On duplicate: return cached response with `X-Idempotent-Replayed: true` header

**Files:** `src/middleware/idempotency.ts` (new), apply in `src/worker.ts`.

---

### T19 — Add Delta Sync Endpoints for Offline-First Clients (E15)
**Phase:** Phase 2
**Priority:** P2

**Objective:** Add `/sync` endpoints to each module that return records changed since a given timestamp.

**Pattern:**
```
GET /api/crm/sync?since=1700000000000
→ { contacts: [...], deals: [...], activities: [...], deleted_ids: [...] }
```

**Why it matters:** PWA/mobile clients (using Dexie/IndexedDB) need to sync only changes, not reload everything. Nigeria's bandwidth is constrained.

**Files:** Add `/sync` route to each module router.

---

### T20 — Implement WhatsApp Webhook Bridge for Ticketing (E17)
**Phase:** Phase 2
**Priority:** P2

**Objective:** Add an inbound webhook handler that converts WhatsApp Business API messages into support tickets.

**Route:** `POST /api/ticketing/webhooks/whatsapp`

**Logic:**
1. Verify webhook signature (WhatsApp HMAC-SHA256)
2. Extract sender phone, message body
3. Look up existing open ticket for this phone+tenant (avoid duplicates)
4. If none: create new ticket with `source: "whatsapp"`, `requester_id: phone`
5. If exists: add as comment

**Files:** `src/modules/ticketing/webhooks/whatsapp.ts` (new)

---

### T21 — Implement Real-time Chat via Durable Objects (E18)
**Phase:** Phase 2
**Priority:** P2

**Objective:** Replace polling-based chat with real-time WebSocket connections using Cloudflare Durable Objects.

**Architecture:**
1. Create `src/durable-objects/ChatRoom.ts` — Durable Object that manages a single conversation's WebSocket connections
2. Upgrade `wrangler.toml` to include Durable Object binding
3. Add WebSocket upgrade endpoint: `GET /api/chat/conversations/:id/ws`
4. On message send: write to D1 AND broadcast to all connected WebSocket clients via DO

**Files:** `src/durable-objects/ChatRoom.ts` (new), `src/modules/chat/api.ts` (add WS route), `wrangler.toml`.

---

### T22 — Implement Attendance Tracking Module (E19)
**Phase:** Phase 2
**Priority:** P2

**Objective:** Build a real attendance tracking system replacing the current stub.

**Schema (migration 010):**
```sql
CREATE TABLE IF NOT EXISTS hrm_attendance (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  employee_id TEXT NOT NULL REFERENCES hrm_employees(id),
  clock_in INTEGER NOT NULL,
  clock_out INTEGER,
  clock_in_lat REAL,
  clock_in_lng REAL,
  clock_out_lat REAL,
  clock_out_lng REAL,
  duration_minutes INTEGER,
  notes TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000)
);
CREATE INDEX IF NOT EXISTS idx_attendance_tenant ON hrm_attendance(tenant_id, employee_id);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON hrm_attendance(tenant_id, clock_in);
```

**API routes:**
- `POST /api/hrm/attendance/clock-in`
- `POST /api/hrm/attendance/clock-out`
- `GET /api/hrm/attendance` — list with filters (employee, date range)
- `GET /api/hrm/attendance/summary` — daily/weekly/monthly aggregates

---

### T23 — Add CRM Custom Fields Engine (E16)
**Phase:** Phase 2
**Priority:** P2

**Objective:** Allow tenants to define and use custom fields on CRM contacts and deals.

**Schema (migration 011):**
```sql
CREATE TABLE IF NOT EXISTS crm_custom_field_defs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,    -- contact, deal
  field_key TEXT NOT NULL,
  field_label TEXT NOT NULL,
  field_type TEXT NOT NULL,     -- text, number, date, select, boolean
  options TEXT,                  -- JSON array for select type
  is_required INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000),
  UNIQUE(tenant_id, entity_type, field_key)
);

CREATE TABLE IF NOT EXISTS crm_custom_field_values (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  field_key TEXT NOT NULL,
  value TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()*1000),
  UNIQUE(tenant_id, entity_id, field_key)
);
```

**API routes:**
- `GET/POST /api/crm/custom-fields` — manage field definitions
- `PATCH /api/crm/contacts/:id/custom-fields` — set values
- Include custom field values in contact GET response

---

### T24 — Improve CI/CD Pipeline (E20)
**Phase:** Phase 2
**Priority:** P2

**Objective:** Add linting, coverage reporting, and staging deploy gate to the CI workflow.

**Changes to `.github/workflows/ci.yml`:**
```yaml
- name: Lint
  run: npm run lint

- name: Test with coverage
  run: npm test -- --coverage

- name: Deploy to staging
  if: github.ref == 'refs/heads/main'
  run: npx wrangler deploy --env staging
  env:
    CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
```

**Also add:** `.github/workflows/deploy-prod.yml` for manual production deploys with approval gate.

---

### T25 — Add Lead Scoring AI to CRM (E — Bonus)
**Phase:** Phase 2
**Priority:** P2

**Objective:** Add AI-powered lead scoring using the `AI_PLATFORM_URL` service.

**Logic:**
1. On contact create/update, send to AI platform: `{ contact, activities_count, deals_count, deal_stages }`
2. AI returns `{ score: 0-100, explanation: "..." }`
3. Store in `crm_contacts.lead_score` column (add via migration)

**Files:** `src/modules/crm/api.ts` (add scoring call after contact mutations)

---

### T26 — Add Global Search Endpoint (E — Bonus)
**Phase:** Phase 2
**Priority:** P2

**Objective:** Implement cross-module search using D1 FTS5 full-text search.

**Route:** `GET /api/search?q=&modules=crm,tickets,chat`

**Returns:** Ranked results from contacts, deals, tickets, conversations.

**Migration:** Add FTS5 virtual tables for searchable entities.

---

## 7. QA PLANS

---

### QA-T01 — tenantId JWT Source
**What to verify:**
- [ ] `tenantId` in all requests is sourced from `c.get("jwtPayload").tenantId`
- [ ] x-tenant-id header is not used as the source of truth
- [ ] Requests with no JWT → 401
- [ ] Requests with expired JWT → 401
- [ ] Requests with JWT tenant A cannot access data of tenant B

**Edge cases:**
- JWT with no `tenantId` field → must 401 not 500
- JWT signed with wrong secret → 401

**Cross-module:** All 5 modules must reject spoofed tenant headers.

**Done:** Zero data-isolation bypass possible through header manipulation.

---

### QA-T02 — SQL Injection Fix
**What to verify:**
- [ ] `vertical` parameter passes through Zod enum validation (rejects invalid values)
- [ ] Parameterized queries used in analytics summary, revenue, and growth endpoints
- [ ] Sending `vertical=commerce'; DROP TABLE --` returns 400 from Zod validation

**Regression:** All analytics queries still return correct data after fix.

**Done:** Zero SQL string interpolation with user input.

---

### QA-T03 — Pagination Count Queries
**What to verify:**
- [ ] CRM contacts: filter by `stage=lead`, verify `total` matches count of leads
- [ ] CRM contacts: filter by `search=John`, verify `total` matches search results
- [ ] HRM employees: filter by `department=Engineering`, verify `total` correct
- [ ] Tickets: filter by `status=open&priority=critical`, verify `total` correct

**Edge cases:**
- Empty result set: `total = 0`, `pages = 0` or `pages = 1`?

**Done:** `pagination.total` exactly equals filtered result count in all cases.

---

### QA-T04 — Test Suite
**What to verify:**
- [ ] `npm test` exits 0
- [ ] All 5 module test files exist and run
- [ ] Minimum 40 tests pass
- [ ] CI step `npm test` shows passing tests

**Edge cases:**
- Mock D1 database must simulate all query patterns (prepare/bind/all/first/run)
- Mock KV namespace for session-based tests

**Done:** CI passes with ≥40 test assertions.

---

### QA-T05 — Logger Replacement
**What to verify:**
- [ ] `grep -r "console\." src/` returns zero results
- [ ] `grep -r "logger\." src/` shows structured log calls in all modules
- [ ] Logs include `tenantId` in context

**Done:** Zero bare console calls in production code.

---

### QA-T06 — generateId / koboToNaira Deduplication
**What to verify:**
- [ ] `grep -r "function generateId" src/` returns zero results
- [ ] `grep -r "function koboToNaira" src/` returns zero results
- [ ] All generated IDs still use the correct prefix format
- [ ] Kobo conversion returns correct values (e.g., 10000 kobo = 100 naira)

**Done:** Zero local helper function duplicates.

---

### QA-T07 — Event Bus Emissions
**What to verify:**
- [ ] Every POST/PATCH/DELETE to a mutating endpoint triggers an event emission
- [ ] Event payloads include `tenantId`, `entityId`, `eventType`, `timestamp`
- [ ] Event emission failure does NOT fail the HTTP response
- [ ] Event types match `WebWakaEventType` enum values

**Edge cases:**
- Queue unavailable → request still succeeds, error logged
- Event schema validation fails → error logged, not returned to caller

**Done:** All TODO stubs replaced; queue binding configured and working.

---

### QA-T08 — RBAC
**What to verify:**
- [ ] CUSTOMER role cannot DELETE a contact → 403
- [ ] CUSTOMER role cannot PATCH a deal → 403
- [ ] STAFF role can CREATE tickets → 201
- [ ] TENANT_ADMIN can approve payroll run → 200
- [ ] Routes without role requirement remain accessible to STAFF

**Edge cases:**
- JWT with no `role` field → must return 403, not 500
- JWT with unknown role → 403

**Done:** All write endpoints enforce minimum role.

---

### QA-T09 — Rate Limiting
**What to verify:**
- [ ] 101st request within 1 minute returns 429 Too Many Requests
- [ ] Different tenants have independent rate limit counters
- [ ] Rate limit resets after window expires

**Done:** Rate limiting active on all `/api/*` routes.

---

### QA-T10 — Audit Logs
**What to verify:**
- [ ] Every POST creates an audit log entry with `action = CREATE`
- [ ] Every PATCH creates an audit log entry with `action = UPDATE`, `old_data`, `new_data`
- [ ] Every DELETE creates an entry with `action = DELETE`
- [ ] `GET /api/audit-logs` returns 403 to non-ADMIN roles
- [ ] `actor_id` correctly reflects the JWT user ID

**Edge cases:**
- Failed DB write → audit log should NOT be created for failed operations
- Very large payloads → truncate `old_data`/`new_data` at 10KB

**Done:** Immutable audit trail for all mutations.

---

### QA-T11 — Chat Tenant Isolation
**What to verify:**
- [ ] Tenant A cannot post messages to Tenant B's conversations
- [ ] `404` returned if conversation belongs to different tenant
- [ ] Read messages (`/messages`) also scoped to tenant

**Done:** Zero cross-tenant chat data access.

---

### QA-T12 — Nigerian Payroll Engine
**What to verify:**
- [ ] PAYE calculated correctly for salary = ₦500,000/month (NGN 6M annual)
  - Annual gross: 6,000,000
  - CRA: 200,000 + 20% of 6M = 200,000 + 1,200,000 = 1,400,000
  - Taxable: 4,600,000
  - PAYE: (300k×7%) + (300k×11%) + (500k×15%) + (500k×19%) + (1,600k×21%) + (1,400k×24%)
  - Expected net after deductions ≈ ₦383,333/month
- [ ] Pension: 8% of basic, capped at NPC limits
- [ ] NHF: 2.5% of basic
- [ ] Net = Gross - PAYE(monthly) - Pension - NHF
- [ ] Payroll run creation generates correct payslips for all active employees
- [ ] Draft → Approved state transition requires TENANT_ADMIN role

**Edge cases:**
- Employee with zero salary → all deductions zero, net zero
- Employee on unpaid leave → exclude from payroll run
- Mid-month joiner → pro-rate salary

**Done:** Statutory deductions match FIRS tables; net pay is mathematically verifiable.

---

### QA-T13 — SLA Engine
**What to verify:**
- [ ] New Critical ticket has `first_response_due = created_at + 1 hour`
- [ ] New High ticket has `resolution_due = created_at + 24 hours`
- [ ] First comment from agent sets `first_responded_at`
- [ ] Ticket resolved before SLA → `sla_breached = 0`
- [ ] Ticket resolved after SLA → `sla_breached = 1`
- [ ] SLA report shows MTTR correctly

**Done:** SLA deadlines set on creation; breaches tracked.

---

### QA-T14 — Workflow Execution Engine
**What to verify:**
- [ ] Create rule: `trigger_type = new_ticket, action = assign_to:agent-123`
- [ ] Create ticket → verify `assigned_to = agent-123`
- [ ] Create rule: `trigger_type = status_change:resolved, action = set_priority:low`
- [ ] Resolve ticket → verify priority changed
- [ ] Inactive rules (`is_active = 0`) are NOT evaluated

**Edge cases:**
- Multiple matching rules — all should execute in order
- Circular rules (status A → status B → status A) — detect and break cycle

**Done:** All active workflow rules execute on the correct triggers.

---

### QA-T15 — Soft Deletes
**What to verify:**
- [ ] DELETE deal sets `deleted_at`, does not remove row
- [ ] GET deals list excludes soft-deleted deals
- [ ] GET deal/:id for soft-deleted deal returns 404
- [ ] Analytics/reports exclude soft-deleted entities

**Done:** No hard deletes on core business entities.

---

### QA-T16 — leave_requests updated_at
**What to verify:**
- [ ] After PATCH leave status, `updated_at` column is set to current timestamp
- [ ] GET leave requests returns `updated_at` field

**Done:** Leave approval timestamps are tracked.

---

### QA-T17 — AI Health Check Timeout
**What to verify:**
- [ ] When AI platform responds within 3s → `ai_platform: true`
- [ ] When AI platform times out → `ai_platform: false` (not a 500 error)
- [ ] Health endpoint responds in under 5 seconds always

**Done:** No worker hangs due to AI platform latency.

---

### QA-T18 — Idempotency
**What to verify:**
- [ ] First POST with `Idempotency-Key: abc123` → 201, creates resource
- [ ] Second POST with same `Idempotency-Key: abc123` → 201, returns same response, no duplicate created
- [ ] `X-Idempotent-Replayed: true` header present on replay
- [ ] Different tenants with same key do not interfere

**Done:** No duplicate entities created on retry.

---

### QA-T19 — Delta Sync
**What to verify:**
- [ ] `/sync?since=0` returns all records
- [ ] `/sync?since=TIMESTAMP` returns only records changed after TIMESTAMP
- [ ] `deleted_ids` array contains soft-deleted entity IDs
- [ ] Empty result returns `{ contacts: [], deleted_ids: [], lastSync: TIMESTAMP }`

**Done:** Clients can sync incrementally.

---

### QA-T20 — WhatsApp Bridge
**What to verify:**
- [ ] Webhook signature validation rejects invalid signatures
- [ ] New WhatsApp message creates ticket with `source = whatsapp`
- [ ] Duplicate message from same phone+tenant adds comment, not new ticket
- [ ] WhatsApp webhook is publicly accessible (no JWT required on this route)

**Done:** WhatsApp messages flow into ticketing system reliably.

---

## 8. IMPLEMENTATION PROMPTS

---

### IMPL-T01: Fix tenantId Security Vulnerability

```
You are a senior Cloudflare Workers engineer working on the repository `webwaka-cross-cutting`.

REPO CONTEXT:
- This is a Cloudflare Workers + Hono + D1 multi-tenant backend.
- It is NOT a standalone application — it is one component of the WebWaka OS v4 platform.
- Platform dependency: `@webwaka/core` v1.6.1 (provides JWT utilities, logger, RBAC, events).
- The platform invariant is: "tenantId MUST be sourced from the validated JWT payload, NEVER from request headers."

OBJECTIVE:
Fix the tenant isolation security vulnerability. The current `src/middleware/tenant.ts` sets `tenantId` from the `x-tenant-id` request header. This allows tenant spoofing.

REQUIRED CHANGES:
1. Modify `src/middleware/auth.ts` to extract `tenantId` from the verified JWT payload (c.get("jwtPayload").tenantId) and set it using `c.set("tenantId", payload.tenantId)`.
2. Modify `src/middleware/tenant.ts` to only validate that `/api/*` routes have a tenant (now sourced from JWT, not header). The x-tenant-id header should be removed from the tenant isolation flow entirely.
3. Update `src/worker.ts` middleware order if needed.
4. Ensure the public `/health` route remains accessible without a JWT.

ECOSYSTEM CAVEAT:
Do not modify `@webwaka/core`. Import and use `verifyJWT`, `jwtAuthMiddleware`, or `JWTPayload` from `@webwaka/core` as appropriate.

IMPORTANT REMINDERS:
- Build Once Use Infinitely: use @webwaka/core auth primitives, do not reinvent JWT verification.
- Multi-Tenant Tenant-as-Code: all data access must use tenantId from JWT.
- Governance-Driven Execution: consult repo docs and @webwaka/core auth module docs before acting.
- No shortcuts: the fix must be complete, not partial.
- TypeScript strict mode must pass after changes.

DELIVERABLES:
- Modified `src/middleware/auth.ts`
- Modified `src/middleware/tenant.ts`
- Optionally modified `src/worker.ts`
- Brief comment in each file explaining the security fix

ACCEPTANCE CRITERIA:
- `npm run typecheck` passes with zero errors.
- A request with JWT tenantId "A" but header x-tenant-id "B" must use tenantId "A".
- A request with no JWT to `/api/*` must return 401.
- A request to `/health` with no JWT must return 200.
- No raw x-tenant-id header value is ever used as the tenantId in any query.

TESTS/VERIFICATION:
- Run `npm run typecheck` and confirm zero errors.
- Use curl to test each scenario above with the local dev server.
```

---

### IMPL-T02: Fix SQL Injection in Analytics Module

```
You are a senior Cloudflare Workers engineer working on the repository `webwaka-cross-cutting`.

REPO CONTEXT:
- Multi-tenant Cloudflare Workers + Hono + Cloudflare D1 backend.
- Analytics module: `src/modules/analytics/api.ts`.
- NOT standalone — part of WebWaka OS v4 platform.

OBJECTIVE:
Fix 3 SQL injection vulnerabilities in `src/modules/analytics/api.ts`. The `vertical` query parameter is interpolated directly into SQL strings via template literals in the summary, revenue, and growth endpoints (approx lines 76, 140, 192).

REQUIRED CHANGES:
For each of the 3 affected endpoints:
1. Remove the `dateFilter` template literal variable.
2. Build the WHERE clause using a boolean flag and add `vertical` as a bound parameter.
3. Use D1's `.bind(...params)` where params is built dynamically.

SAFE PATTERN:
```typescript
const params: any[] = [tenantId, start];
let verticalClause = "";
if (query.vertical) {
  verticalClause = "AND vertical = ?";
  params.push(query.vertical);
}
// In SQL: WHERE tenant_id = ? AND created_at >= ? ${verticalClause}
// .bind(...params)
```

IMPORTANT REMINDERS:
- Zod enum validation already rejects invalid vertical values — but parameterization is still required for defense-in-depth.
- Do not change the business logic or response structure.
- TypeScript strict mode must pass.
- Zero SQL string interpolation with user-controlled values.

DELIVERABLES:
- Modified `src/modules/analytics/api.ts` with all 3 injection points fixed.

ACCEPTANCE CRITERIA:
- `npm run typecheck` passes.
- Sending `?vertical=commerce'; DROP TABLE--` returns 400 (Zod rejects it) or returns valid empty response.
- Analytics endpoints still return correct data with valid `vertical` filter.
```

---

### IMPL-T03: Fix Pagination Count Query Bugs

```
You are a senior Cloudflare Workers engineer working on `webwaka-cross-cutting`.

OBJECTIVE:
Fix the pagination count query bug in 3 modules where `pagination.total` ignores query filters.

AFFECTED FILES:
1. `src/modules/crm/api.ts` — contacts list endpoint
2. `src/modules/hrm/api.ts` — employees list endpoint
3. `src/modules/ticketing/api.ts` — tickets list endpoint

REQUIRED APPROACH:
Refactor each list endpoint to build the WHERE clause and params array once, then reuse them for both the list query and the count query. Example:

```typescript
// Build shared filter
let whereClause = "WHERE tenant_id = ? AND deleted_at IS NULL";
const filterParams: any[] = [tenantId];

if (stage) {
  whereClause += " AND stage = ?";
  filterParams.push(stage);
}
if (search) {
  whereClause += " AND (full_name LIKE ? OR email LIKE ?)";
  const s = `%${search}%`;
  filterParams.push(s, s);
}

// Count query uses same filters:
const countResult = await c.env.DB.prepare(`SELECT COUNT(*) as count FROM crm_contacts ${whereClause}`)
  .bind(...filterParams).first();

// List query adds pagination:
const listResult = await c.env.DB.prepare(`SELECT * FROM crm_contacts ${whereClause} ORDER BY updated_at DESC LIMIT ? OFFSET ?`)
  .bind(...filterParams, limit, offset).all();
```

DELIVERABLES:
- Modified `src/modules/crm/api.ts`, `hrm/api.ts`, `ticketing/api.ts`.

ACCEPTANCE CRITERIA:
- Create 5 contacts in stage "lead", 5 in stage "won".
- GET /contacts?stage=lead → `pagination.total = 5`.
- GET /contacts → `pagination.total = 10`.
```

---

### IMPL-T04: Restore and Expand Test Suite

```
You are a TypeScript/Vitest engineer working on `webwaka-cross-cutting`.

REPO CONTEXT:
- Cloudflare Workers + Hono + Vitest.
- Test file `src/modules/analytics/api.test.ts.bak` exists but is renamed and excluded.
- Current CI: `npm test` runs zero tests (vacuously passes).

OBJECTIVE:
Restore the analytics test and create test files for all 5 modules (CRM, HRM, Ticketing, Chat, Analytics).

REQUIRED FOR EACH TEST FILE:
1. Use the Mock D1/KV pattern from `api.test.ts.bak` as a template.
2. Cover: GET module info, POST create (valid + invalid), GET list, GET single (found + not found), PATCH update, DELETE.
3. Test 401 unauthorized when no tenantId.
4. Mock the Hono app with middleware that injects `tenantId` and `jwtPayload`.

FILES TO CREATE:
- `src/modules/analytics/api.test.ts` (from .bak)
- `src/modules/crm/api.test.ts`
- `src/modules/hrm/api.test.ts`
- `src/modules/ticketing/api.test.ts`
- `src/modules/chat/api.test.ts`

IMPORTANT REMINDERS:
- Do NOT use real D1 databases in tests — use the mock pattern.
- Use `describe/it/expect` from Vitest (globals: true is set).
- Each test must be deterministic and not depend on execution order.
- Minimum 8 tests per module.

DELIVERABLES:
- 5 test files with ≥8 tests each.
- `npm test` exits 0 with ≥40 passing tests.

ACCEPTANCE CRITERIA:
- `npm test` shows 40+ passing tests.
- CI step passes.
```

---

### IMPL-T05: Replace console.log with @webwaka/core Logger

```
You are a TypeScript engineer on `webwaka-cross-cutting`.

OBJECTIVE:
Replace ALL `console.error()`, `console.log()`, `console.warn()` calls in `src/modules/*/api.ts` with the platform logger from `@webwaka/core`.

ECOSYSTEM CAVEAT:
This repo uses `@webwaka/core` v1.6.1 which exports a `logger` instance with `.info()`, `.warn()`, `.error()`, `.debug()` methods. Each method accepts `(message: string, context?: LogContext, error?: Error)`.

IMPORT:
```typescript
import { logger } from "@webwaka/core";
```

USAGE:
```typescript
// Before:
console.error("Contacts list error:", error);
// After:
logger.error("Contacts list error", { tenantId }, error);
```

FILES TO CHANGE:
- `src/modules/crm/api.ts`
- `src/modules/hrm/api.ts`
- `src/modules/ticketing/api.ts`
- `src/modules/chat/api.ts`
- `src/modules/analytics/api.ts`

ACCEPTANCE CRITERIA:
- `grep -r "console\." src/` returns zero results.
- `npm run typecheck` passes.
- Log context includes `tenantId` in every logger call.
```

---

### IMPL-T06: Deduplicate generateId and koboToNaira

```
You are a TypeScript engineer on `webwaka-cross-cutting`.

OBJECTIVE:
Remove the `generateId()` and `koboToNaira()` helper functions that are duplicated in all 5 module files and replace them with imports from `@webwaka/core` or a single shared util.

STEP 1 — Check @webwaka/core:
Run: `cat node_modules/@webwaka/core/dist/nanoid.d.ts`
If it exports a suitable ID generator, use it. If not, create `src/utils/helpers.ts` with:
```typescript
export function generateId(prefix: string): string { ... }
export function koboToNaira(kobo: number): number { return kobo / 100; }
```

STEP 2 — Update all module files:
Remove local `generateId` and `koboToNaira` functions from all 5 api.ts files.
Add import from `@webwaka/core/nanoid` or from `../../utils/helpers`.

DELIVERABLES:
- `src/utils/helpers.ts` (if needed)
- Modified `src/modules/crm/api.ts`, `hrm/api.ts`, `ticketing/api.ts`, `chat/api.ts`, `analytics/api.ts`

ACCEPTANCE CRITERIA:
- `grep -r "function generateId" src/modules/` returns zero results.
- `grep -r "function koboToNaira" src/modules/` returns zero results.
- `npm run typecheck` passes.
- Generated IDs still have correct prefix format.
```

---

### IMPL-T07: Implement Event Bus Emissions

```
You are a senior Cloudflare Workers architect working on `webwaka-cross-cutting`.

REPO CONTEXT:
- Cloudflare Workers + Hono + D1 + Cloudflare Queues.
- `@webwaka/core` v1.6.1 exports `WebWakaEventType` enum and event emission helpers.
- Platform principle: "Event-Driven — NO direct inter-DB access. All cross-module communication via events."
- Currently ALL 20+ `// TODO: Emit event to event bus` stubs are dead code.

OBJECTIVE:
Replace all event emission stubs with a real implementation using Cloudflare Queues.

REQUIRED IMPLEMENTATION:

1. Add Queue binding to `wrangler.toml`:
```toml
[[queues.producers]]
queue = "xct-events"
binding = "EVENTS_QUEUE"
```

2. Add `EVENTS_QUEUE: Queue` to the `Env` type in `src/worker.ts`.

3. Create `src/utils/eventEmitter.ts`:
```typescript
import { WebWakaEventType } from "@webwaka/core";
import type { Env } from "../worker";

export interface XctEvent {
  type: string;
  tenantId: string;
  entityId: string;
  entityType: string;
  payload: Record<string, any>;
  timestamp: number;
}

export async function emitEvent(env: Env, event: XctEvent): Promise<void> {
  if (!env.EVENTS_QUEUE) return; // Graceful no-op if queue not configured
  try {
    await env.EVENTS_QUEUE.send(event, { contentType: "json" });
  } catch (err) {
    // Non-blocking: log error but never fail the request
    logger.error("Event emission failed", { tenantId: event.tenantId, eventType: event.type });
  }
}
```

4. In each module, after every DB mutation, call `await emitEvent(c.env, { ... })`.
   Map each operation to an appropriate event type from `WebWakaEventType` or use XCT-specific strings.

ECOSYSTEM CAVEAT:
The Queue consumer (that aggregates events into analytics or triggers notifications) lives in another WebWaka service. This repo only needs to EMIT events, not consume them.

IMPORTANT REMINDERS:
- Event emission MUST be non-blocking (fire-and-forget pattern).
- Event emission failure must NEVER fail the user-facing HTTP response.
- Use typed event payloads matching platform contracts.
- Remove all `// TODO: Emit event to event bus` comments.

DELIVERABLES:
- Modified `wrangler.toml`
- Modified `src/worker.ts` (Env type)
- New `src/utils/eventEmitter.ts`
- Modified all 5 `src/modules/*/api.ts` files (event emissions after mutations)

ACCEPTANCE CRITERIA:
- Zero `// TODO: Emit event` comments in codebase.
- `npm run typecheck` passes.
- Event emission failure does not cause 500 responses.
- wrangler.toml has queue binding.
```

---

### IMPL-T08: Implement RBAC on Write Endpoints

```
You are a TypeScript engineer on `webwaka-cross-cutting`.

REPO CONTEXT:
- Uses `@webwaka/core/rbac` which exports `requireRole` and `Role` enum.
- Roles: SUPER_ADMIN, TENANT_ADMIN, STAFF, CUSTOMER.
- Currently any authenticated user can delete records.

OBJECTIVE:
Apply `requireRole` middleware to all state-changing endpoints across all 5 modules.

ROLE MATRIX:
- GET endpoints: any authenticated user (STAFF minimum)
- POST (create): STAFF, TENANT_ADMIN
- PATCH (update): STAFF, TENANT_ADMIN
- DELETE: TENANT_ADMIN only
- Payroll approval: TENANT_ADMIN only
- Workflow management: TENANT_ADMIN only

IMPORT:
```typescript
import { requireRole, Role } from "@webwaka/core/rbac";
```

USAGE (route-level middleware):
```typescript
crmRouter.delete("/contacts/:id",
  requireRole([Role.TENANT_ADMIN]),
  async (c) => { ... }
);
```

IMPORTANT REMINDERS:
- `requireRole` must run AFTER `authMiddleware` (JWT must be verified first).
- Do not modify @webwaka/core.
- TypeScript strict mode must pass.

DELIVERABLES:
- Modified `src/modules/crm/api.ts`, `hrm/api.ts`, `ticketing/api.ts`, `chat/api.ts`, `analytics/api.ts`.

ACCEPTANCE CRITERIA:
- CUSTOMER role JWT → DELETE contact → 403.
- TENANT_ADMIN role JWT → DELETE contact → 200.
- STAFF role JWT → GET contacts → 200.
- `npm run typecheck` passes.
```

---

### IMPL-T09: Implement Rate Limiting

```
You are a Cloudflare Workers engineer on `webwaka-cross-cutting`.

OBJECTIVE:
Add per-tenant rate limiting to all API endpoints using `rateLimit` from `@webwaka/core/auth`.

IMPLEMENTATION:
1. Import `rateLimit` from `@webwaka/core/auth`.
2. In `src/worker.ts`, after auth middleware, add:
```typescript
import { rateLimit } from "@webwaka/core/auth";
app.use("/api/*", rateLimit({
  windowMs: 60000,
  max: 100,
  kvNamespace: env.SESSIONS_KV,
  keyPrefix: "rate_limit:",
}));
```
3. Ensure `SESSIONS_KV` is available in development via `wrangler.toml`.

DELIVERABLES:
- Modified `src/worker.ts`.
- Modified `wrangler.toml` if KV binding needed for dev.

ACCEPTANCE CRITERIA:
- 101st request within a minute returns 429.
- Different tenants have independent rate limit windows.
```

---

### IMPL-T10: Implement Audit Log System

```
You are a Cloudflare Workers engineer on `webwaka-cross-cutting`.

OBJECTIVE:
Implement a comprehensive audit logging system.

STEP 1 — Create migration (migrations/005_audit_logs.sql):
```sql
CREATE TABLE IF NOT EXISTS global_audit_logs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  old_data TEXT,
  new_data TEXT,
  ip_address TEXT,
  user_agent TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000)
);
CREATE INDEX IF NOT EXISTS idx_audit_tenant ON global_audit_logs(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON global_audit_logs(entity_type, entity_id);
```

STEP 2 — Create `src/middleware/audit.ts`:
A Hono middleware that, for POST/PATCH/DELETE requests:
- Captures `actor_id` from JWT payload
- Captures `entity_type` and `entity_id` from route params
- Fetches current state from DB (for PATCH/DELETE)
- Writes to `global_audit_logs` using `c.executionCtx.waitUntil()` for async non-blocking write

STEP 3 — Add audit endpoint:
`GET /api/audit-logs?entity_type=&entity_id=&page=` (TENANT_ADMIN only)

STEP 4 — Apply middleware in `src/worker.ts`:
```typescript
app.use("/api/*", auditMiddleware);
```

IMPORTANT REMINDERS:
- Audit writes must be non-blocking (use `c.executionCtx.waitUntil`).
- Use platform logger, not console.
- NDPR compliance: audit logs must be retained but redactable.

DELIVERABLES:
- `migrations/005_audit_logs.sql`
- `src/middleware/audit.ts`
- Modified `src/worker.ts`
- Audit endpoint in appropriate router (e.g., `src/modules/crm/api.ts` or a new `audit.ts` router)
```

---

### IMPL-T12: Nigerian Payroll Engine — Phase 1

```
You are a senior TypeScript engineer building the payroll module for `webwaka-cross-cutting`.

REPO CONTEXT:
- Nigeria-First platform. Currency stored in kobo (integer).
- HRM module: `src/modules/hrm/`.
- Uses Cloudflare D1 for data storage.

OBJECTIVE:
Implement the Nigerian statutory payroll calculation engine.

NIGERIAN TAX RULES (2024 FIRS):
Annual PAYE bands (applied to taxable income = gross - CRA):
- ₦0 – ₦300,000: 7%
- ₦300,001 – ₦600,000: 11%
- ₦600,001 – ₦1,100,000: 15%
- ₦1,100,001 – ₦1,600,000: 19%
- ₦1,600,001 – ₦3,200,000: 21%
- Above ₦3,200,000: 24%

CRA = ₦200,000 + 20% of gross annual salary (or 1% of gross, whichever is higher)
Pension employee: 8% of basic salary per month
NHF: 2.5% of basic salary per month
NSITF: 1% of gross by employer (not deducted from employee)

IMPLEMENTATION:

1. Create `migrations/006_payroll_schema.sql` with `hrm_payroll_runs` and `hrm_payslips` tables (see Task T12 schema).

2. Create `src/modules/hrm/payroll.ts`:
```typescript
export function calculatePayroll(grossKobo: number): {
  grossKobo: number;
  payeKobo: number;
  pensionEmployeeKobo: number;
  nhfKobo: number;
  nsitfKobo: number;
  netKobo: number;
}
```

3. Create API routes in `src/modules/hrm/api.ts` (or new payrollRoutes.ts):
- POST /payroll/run — draft payroll for all active employees
- GET /payroll/runs — list runs
- GET /payroll/runs/:id — run detail with payslips
- PATCH /payroll/runs/:id/approve — approve (TENANT_ADMIN only)
- GET /payslips/:id — individual payslip

IMPORTANT REMINDERS:
- Nigeria-First: all PAYE/statutory rules must match current FIRS guidelines.
- Store all values as kobo (integers). Never use float for money.
- Event emission: emit `xct.hrm.payroll.run_created` and `xct.hrm.payroll.approved` events.
- RBAC: payroll approval requires TENANT_ADMIN role.

ACCEPTANCE CRITERIA:
- Employee with ₦500,000 gross/month → correct PAYE, pension, NHF calculated.
- POST payroll/run creates draft with correct payslip for each active employee.
- Approved run cannot be re-opened.
- `npm run typecheck` passes.
```

---

### IMPL-T13: Ticketing SLA Engine

```
You are a TypeScript engineer on `webwaka-cross-cutting`.

OBJECTIVE:
Build the SLA engine for the Ticketing module.

IMPLEMENTATION:

1. Add migration `migrations/007_sla_schema.sql`:
   - Columns to tickets: `first_response_due`, `resolution_due`, `first_responded_at`, `sla_breached`
   - New table: `sla_policies` (see Task T13 schema)

2. In `src/modules/ticketing/api.ts`:
   - On ticket create: look up SLA policy for priority, calculate and set `first_response_due` and `resolution_due`
   - On first agent comment: if `first_responded_at IS NULL`, set it
   - On ticket resolve: compare resolution time vs `resolution_due`, set `sla_breached`

3. Add default SLA policies (seed in migration or first-run logic):
   - critical: 60 min response, 240 min resolution
   - high: 240 min response, 1440 min resolution
   - medium: 480 min response, 4320 min resolution
   - low: 1440 min response, 10080 min resolution

4. New endpoints:
   - GET /api/ticketing/sla-policies — list
   - POST /api/ticketing/sla-policies — create/update
   - GET /api/ticketing/sla-report — MTTR and breach stats

ACCEPTANCE CRITERIA:
- Critical ticket created at T → first_response_due = T + 3600000ms
- MTTR report returns average resolution time correctly
```

---

### IMPL-T14: Ticket Workflow Execution Engine

```
You are a TypeScript engineer on `webwaka-cross-cutting`.

OBJECTIVE:
Build the actual workflow rule execution engine for the Ticketing module.

IMPLEMENTATION:

Create `src/modules/ticketing/workflowEngine.ts`:
```typescript
export async function evaluateWorkflows(
  env: Env,
  tenantId: string,
  ticketId: string,
  triggerType: string,
  triggerValue: string
): Promise<void> { ... }
```

Trigger evaluateWorkflows from:
1. `POST /tickets` → triggerType: `new_ticket`, triggerValue: ticket.priority or ticket.category
2. `PATCH /tickets/:id` → when status changes: triggerType: `status_change`, triggerValue: new status
3. `PATCH /tickets/:id` → when priority changes: triggerType: `priority_change`, triggerValue: new priority

Supported actions:
- `assign_to`: UPDATE tickets SET assigned_to = ?
- `set_status`: UPDATE tickets SET status = ?
- `set_priority`: UPDATE tickets SET priority = ?
- `send_notification`: emit an event for the notification service

ACCEPTANCE CRITERIA:
- Rule: new_ticket → assign_to:agent-123 → creating ticket auto-assigns it.
- Rule: status_change:resolved → send_notification → event emitted.
- Inactive rules not evaluated.
```

---

## 9. QA PROMPTS

---

### QA-PROMPT-T01: Verify tenantId Security Fix

```
You are a senior QA engineer testing security fixes in `webwaka-cross-cutting`.

OBJECTIVE:
Verify that the tenantId is now sourced from the JWT payload, not from the x-tenant-id header.

REPO CONTEXT:
- Cloudflare Workers + Hono + D1 backend. NOT standalone.
- Recent change: auth middleware now extracts tenantId from JWT, not x-tenant-id header.

TEST CASES TO EXECUTE:

1. TENANT SPOOFING TEST:
   - Generate JWT with tenantId = "tenant-A"
   - Send request with x-tenant-id: tenant-B
   - Create a contact → verify it's created under tenant-A (not tenant-B)
   - GET /api/crm/contacts with x-tenant-id: tenant-B → should return tenant-A data (JWT wins)

2. NO JWT TEST:
   - Send request to /api/crm/contacts with no Authorization header → must return 401

3. EXPIRED JWT TEST:
   - Use an expired JWT → must return 401, not 500

4. INVALID JWT SIGNATURE TEST:
   - Tamper with JWT signature → must return 401

5. HEALTH ENDPOINT TEST:
   - GET /health with no JWT → must return 200 (public endpoint)

BUGS TO LOOK FOR:
- tenantId still being read from header anywhere in the code
- SQL queries filtering by x-tenant-id header value
- 500 errors instead of 401 for malformed JWTs

REGRESSION:
- Normal authenticated requests must still work with correct tenant scoping.

DONE WHEN:
- All 5 test cases pass as expected.
- grep -r "c.req.header.*tenant" src/ returns zero hits that are used for data scoping.
```

---

### QA-PROMPT-T02: Verify SQL Injection Fix

```
You are a QA engineer testing security fixes in `webwaka-cross-cutting`.

OBJECTIVE:
Verify that SQL injection is no longer possible in the analytics endpoints.

TEST CASES:

1. INJECTION ATTEMPT:
   - GET /api/analytics/summary?vertical=commerce';DROP TABLE analytics_events;--
   - Expected: 400 (Zod rejects the enum value) — NOT a 500 or silent execution

2. VALID FILTER:
   - GET /api/analytics/summary?vertical=commerce
   - Expected: 200 with valid data

3. NULL FILTER:
   - GET /api/analytics/summary (no vertical)
   - Expected: 200 with data from all verticals

4. ALL 3 ENDPOINTS:
   - Repeat tests for /revenue and /growth endpoints

REGRESSION:
- Valid vertical filters must still return correct filtered data.

DONE WHEN:
- Zero SQL string interpolation of user input found in codebase.
- Injection attempt never reaches the database.
```

---

### QA-PROMPT-T04: Verify Test Suite

```
You are a QA engineer on `webwaka-cross-cutting`.

OBJECTIVE:
Verify that the test suite is fully restored and functional.

TESTS TO RUN:
1. `npm test` — must exit 0
2. Count passing tests — must be ≥40
3. Verify test files exist for all 5 modules
4. Verify CI step runs tests in `.github/workflows/ci.yml`

EDGE CASES:
- Mock D1 handles all query patterns (prepare/bind/first/all/run)
- 401 tests: requests without tenant context return 401
- Validation tests: invalid Zod schemas return 400 with `details`

REGRESSION:
- No existing functionality should be broken by the tests.
- Tests must be deterministic (no reliance on external services).

DONE WHEN:
- `npm test` outputs "X tests passed" where X ≥ 40.
- Zero test failures.
- CI workflow step passes.
```

---

### QA-PROMPT-T07: Verify Event Bus Emissions

```
You are a QA engineer verifying event bus integration in `webwaka-cross-cutting`.

OBJECTIVE:
Verify that all mutation endpoints emit typed events to the Cloudflare Queue.

TEST APPROACH (since Queue is async, use wrangler tail or mock):

1. MOCK VERIFICATION:
   - In unit tests, mock `env.EVENTS_QUEUE.send` and assert it's called on each mutation
   - Verify event type, tenantId, entityId, entityType are present

2. WRANGLER TAIL TEST (integration):
   - Run `wrangler dev`
   - In another terminal: `wrangler tail --format=json`
   - Make a POST to create a contact → verify event log appears

3. FAILURE TOLERANCE:
   - Simulate queue failure (set EVENTS_QUEUE to null) → request must still return 201

4. ZERO TODO COMMENTS:
   - grep -r "TODO: Emit event" src/ → must return zero results

BUGS TO LOOK FOR:
- Missing event emission for DELETE endpoints
- Event emitted before DB write (should be after)
- Event failure causing 500 response

DONE WHEN:
- Zero TODO stubs.
- All mutations emit events.
- Failures are non-blocking.
```

---

### QA-PROMPT-T12: Verify Nigerian Payroll Engine

```
You are a QA engineer verifying the Nigerian payroll engine in `webwaka-cross-cutting`.

OBJECTIVE:
Mathematically verify statutory deduction calculations and API correctness.

TEST CASE 1 — Standard employee:
Input: gross monthly salary = ₦500,000 (50,000,000 kobo)
Annual gross = ₦6,000,000
CRA = ₦200,000 + 20% of ₦6,000,000 = ₦200,000 + ₦1,200,000 = ₦1,400,000
Taxable income = ₦6,000,000 - ₦1,400,000 = ₦4,600,000

PAYE calculation:
- ₦300,000 × 7% = ₦21,000
- ₦300,000 × 11% = ₦33,000
- ₦500,000 × 15% = ₦75,000
- ₦500,000 × 19% = ₦95,000
- ₦1,600,000 × 21% = ₦336,000
- ₦1,400,000 × 24% = ₦336,000
Annual PAYE = ₦896,000
Monthly PAYE = ₦74,666.67 → 7,466,667 kobo (round correctly)

Pension (8% of monthly basic): ₦40,000 = 4,000,000 kobo
NHF (2.5% of monthly basic): ₦12,500 = 1,250,000 kobo
Net = ₦500,000 - ₦74,667 - ₦40,000 - ₦12,500 = ₦372,833

Verify API returns net ≈ 37,283,300 kobo.

TEST CASE 2 — Zero salary employee:
- All deductions zero, net zero.

TEST CASE 3 — Employee on unpaid leave:
- Should be excluded from payroll run.

API FLOW TEST:
1. Create employees with known salaries
2. POST /api/hrm/payroll/run with period_month = YYYY-MM
3. GET run → verify payslips exist for all active employees
4. PATCH run/approve (TENANT_ADMIN JWT) → status = approved
5. PATCH run/approve again → should fail (idempotent or already approved error)

DONE WHEN:
- PAYE for test case 1 within ±1 kobo of expected value (rounding tolerance).
- All statutory deductions mathematically correct.
- Payroll approval requires TENANT_ADMIN role.
```

---

### QA-PROMPT-T13: Verify SLA Engine

```
You are a QA engineer verifying the SLA engine in `webwaka-cross-cutting`.

TEST CASES:

1. SLA DEADLINE CALCULATION:
   - Create critical ticket → first_response_due must be created_at + 3,600,000ms
   - Create high ticket → resolution_due must be created_at + 86,400,000ms

2. FIRST RESPONSE TRACKING:
   - Post agent comment → first_responded_at is set
   - Post customer comment → first_responded_at not affected

3. BREACH DETECTION:
   - Create ticket with resolution_due = now - 1000ms → sla_breached should be 1
   - GET /api/ticketing/sla-report → breach count > 0

4. MTTR REPORT:
   - Create 3 tickets, resolve them at different times
   - MTTR = average time from created_at to resolved_at

REGRESSION:
- Existing ticket CRUD still works after schema additions.

DONE WHEN:
- SLA deadlines calculated correctly for all 4 priorities.
- First response and resolution tracked correctly.
- MTTR report returns mathematically correct average.
```

---

## 10. PRIORITY ORDER

**Phase 1 — Critical & High (P0/P1) — Implement First:**

| Order | Task | Reason |
|---|---|---|
| 1 | T01 — tenantId Security Fix | Existential security bug |
| 2 | T02 — SQL Injection Fix | Existential security bug |
| 3 | T17 — AI Health Timeout | Prevents worker hangs |
| 4 | T11 — Chat Tenant Isolation | High data-isolation risk |
| 5 | T03 — Pagination Count Bugs | Wrong data to all clients |
| 6 | T12 — Payroll Engine | Core missing feature |
| 7 | T05 — Logger Replacement | Platform compliance |
| 8 | T06 — Dedup generateId/koboToNaira | Code hygiene before expansion |
| 9 | T04 — Restore Tests | CI quality gate |
| 10 | T07 — Event Bus | Platform architecture |
| 11 | T08 — RBAC | Security |
| 12 | T09 — Rate Limiting | Security |
| 13 | T10 — Audit Logs | Compliance |
| 14 | T13 — SLA Engine | Core ticketing feature |
| 15 | T14 — Workflow Execution | Enables automation |
| 16 | T15 — Soft Deletes | Data integrity |
| 17 | T16 — Leave updated_at | Data completeness |

**Phase 2 — Medium Priority (P2) — Implement Second:**

| Order | Task |
|---|---|
| 18 | T18 — Idempotency Keys |
| 19 | T19 — Delta Sync |
| 20 | T20 — WhatsApp Bridge |
| 21 | T21 — Real-time Chat (Durable Objects) |
| 22 | T22 — Attendance Tracking |
| 23 | T23 — CRM Custom Fields |
| 24 | T24 — CI/CD Improvements |
| 25 | T25 — Lead Scoring AI |
| 26 | T26 — Global Search |

---

## 11. DEPENDENCIES

```
T01 (tenantId fix) → blocks T08 (RBAC) and T10 (Audit Logs)
T02 (SQL injection) → independent
T04 (Tests) → depends on T05, T06 (clean code first)
T05 (Logger) → independent; should be done before T04
T06 (Dedup helpers) → independent
T07 (Events) → depends on T01 (correct tenantId in events)
T08 (RBAC) → depends on T01
T09 (Rate limiting) → depends on T01 (for per-tenant keys)
T10 (Audit logs) → depends on T01, T08
T12 (Payroll) → depends on T06 (shared currency utils), T08 (RBAC)
T13 (SLA) → independent (DB migration only)
T14 (Workflow execution) → depends on T13 (SLA) for context
T15 (Soft deletes) → independent (migration + code)
T16 (leave updated_at) → independent
T18 (Idempotency) → depends on T01
T19 (Delta sync) → depends on T15 (soft deletes for deleted_ids)
T20 (WhatsApp) → depends on T14 (workflow execution for routing rules)
T21 (Real-time chat) → depends on T11 (tenant isolation fix)
T22 (Attendance) → depends on T12 (payroll integration)
T23 (Custom fields) → depends on T06 (shared helpers)
T24 (CI/CD) → depends on T04 (tests must pass)
T25 (Lead Scoring) → depends on T07 (events) and T08 (RBAC)
T26 (Global search) → depends on T15 (soft deletes respected in search)
```

---

## 12. PHASE 1 / PHASE 2 SPLIT

### Phase 1 — Foundation & Security (Tasks T01–T17)
**Goal:** Fix all security vulnerabilities, restore test coverage, implement critical missing features (payroll, SLA, workflow execution), and ensure platform compliance.

**Target outcome:** A production-ready, secure, compliant, and tested multi-tenant backend with all critical XCT epics functional.

**Completion criteria:**
- Zero SQL injection vulnerabilities
- Zero tenantId spoofing risk
- Zero console.log violations
- Nigerian payroll engine working
- SLA engine active
- Workflow rules executing
- Event bus emitting
- RBAC enforced
- Rate limiting active
- Audit logs captured
- ≥40 tests passing

### Phase 2 — Features & Scale (Tasks T18–T26)
**Goal:** Add advanced capabilities: real-time chat, WhatsApp integration, idempotency, offline sync, attendance, custom fields, AI lead scoring, and enhanced CI/CD.

**Target outcome:** A world-class cross-cutting platform ready for enterprise-scale multi-tenant deployment across Africa.

**Completion criteria:**
- Real-time chat via Durable Objects
- WhatsApp bridge functional
- Idempotency prevents duplicates
- Delta sync enables offline-first PWA
- Attendance tracking live
- Custom fields for CRM
- AI lead scoring integrated
- CI/CD deploys to staging automatically

---

## 13. REPO CONTEXT AND ECOSYSTEM NOTES

### 13.1 What this repo does NOT own

This is critical context for implementation agents:

1. **JWT signing and user management** — Handled by `webwaka-super-admin-v2` or a dedicated auth service. This repo only VERIFIES tokens.
2. **AI inference** — Handled by `webwaka-ai-platform`. This repo calls `AI_PLATFORM_URL` for insights; never calls LLMs directly.
3. **Email/SMS/Push notification delivery** — Handled by `@webwaka/core` notifications module. This repo emits events; delivery is handled downstream.
4. **Billing and subscription gating** — Handled by `@webwaka/core/billing`. This repo should check billing status for feature flags.
5. **File storage (R2)** — Not yet wired. When implementing file uploads (payslips, employee documents, chat media), R2 binding must be added via platform infra.
6. **KYC verification** — Handled by `@webwaka/core/kyc`. HRM employee onboarding may trigger KYC.
7. **Event consumption** — This repo emits events to Cloudflare Queues. The queue consumer (analytics aggregation, notification triggering) lives in another service.
8. **Frontend UI** — This repo is API-only. Frontend clients consume this API.

### 13.2 Cross-repo contracts this repo must respect

- All JWTs must use the same `JWT_SECRET` across all WebWaka services.
- All `tenant_id` values must match records in the super-admin's tenant table.
- Event types must match `WebWakaEventType` enum in `@webwaka/core`.
- `INTER_SERVICE_SECRET` must match all other WebWaka services (for internal calls).

### 13.3 How other repos may depend on this repo

- Frontend clients (vertical-specific UIs) consume `/api/crm`, `/api/hrm`, `/api/ticketing`, `/api/chat`, `/api/analytics`.
- The analytics aggregation service may subscribe to events from this repo's queue.
- WhatsApp bridge (T20) will be called by a messaging gateway service via webhook.

---

## 14. GOVERNANCE AND REMINDER BLOCK

Every implementation agent working on this repo must read and internalize the following principles before taking any action:

### Platform Principles

| Principle | Application in this repo |
|---|---|
| **Build Once Use Infinitely** | Import `generateId`, `logger`, `rateLimit`, `requireRole`, `jwtAuthMiddleware`, `emitEvent` from `@webwaka/core`. Never reinvent. |
| **Mobile/PWA/Offline First** | Add `since` param to all list endpoints. Emit `deleted_at` in sync responses. |
| **Nigeria-First, Africa-Ready** | Use kobo everywhere. Implement FIRS-compliant PAYE. Support WhatsApp. |
| **Vendor Neutral AI** | Call `AI_PLATFORM_URL` (which uses OpenRouter internally). Never call OpenAI/Anthropic directly. |
| **Multi-Tenant Tenant-as-Code** | Every query must include `WHERE tenant_id = ?`. tenantId from JWT only. |
| **Event-Driven** | Every mutation emits an event. No direct cross-DB access. |
| **Thoroughness Over Speed** | Do not skip tests, migrations, or error handling. |
| **Zero Skipping Policy** | Do not say "this is a placeholder" and move on. |
| **Multi-Repo Platform Architecture** | Check if a capability exists in `@webwaka/core` before building it here. |
| **Governance-Driven Execution** | Read this document and the Blueprint before making architectural decisions. |
| **CI/CD Native Development** | All changes must pass `npm run typecheck` and `npm test` before being considered done. |
| **Cloudflare-First Deployment** | Use Cloudflare Queues, D1, KV, R2, Durable Objects — not third-party equivalents. |

### Critical Don'ts

- ❌ Do NOT source `tenantId` from `x-tenant-id` header
- ❌ Do NOT use string template interpolation in SQL
- ❌ Do NOT use `console.log` or `console.error`
- ❌ Do NOT add a new `generateId()` function — use `@webwaka/core/nanoid`
- ❌ Do NOT make direct LLM API calls — use `AI_PLATFORM_URL`
- ❌ Do NOT access another module's D1 tables directly — emit events
- ❌ Do NOT leave `// TODO` comments without a corresponding task
- ❌ Do NOT assume this repo is standalone — check ecosystem context first

### Critical Dos

- ✅ DO use `@webwaka/core` for all shared primitives
- ✅ DO store all monetary values as kobo (integer)
- ✅ DO emit typed events after every mutation
- ✅ DO apply RBAC to every write endpoint
- ✅ DO add soft deletes, not hard deletes
- ✅ DO run `npm run typecheck` before calling a task done
- ✅ DO write/update tests for every new feature
- ✅ DO include `tenant_id` in every INSERT

---

## 15. EXECUTION READINESS NOTES

### For Replit Agents

This taskbook is designed for direct use by Replit implementation agents. Before starting any task:

1. **Read this document fully** — especially Section 13 (Ecosystem Notes) and Section 14 (Governance).
2. **Check `@webwaka/core` exports** — run `cat node_modules/@webwaka/core/dist/index.d.ts` to see all available primitives.
3. **Run `npm run typecheck` as your last step** — do not declare a task done until TypeScript passes.
4. **Run `npm test` after completing any task** — do not break existing tests.
5. **Check for `// TODO` comments** — if your task should remove them, verify they are gone.
6. **Never edit `node_modules`** — request changes to `@webwaka/core` via the core team.

### Current State of the Repo (April 2026)

- **Running:** `npm run dev` starts wrangler on port 5000. Health check at `GET /health` returns `{ status: "ok" }`.
- **Tests:** Zero active tests (test file renamed to `.bak`).
- **Security:** 2 critical bugs (tenantId spoofing, SQL injection) must be fixed before any production deployment.
- **Events:** All event emissions are TODO stubs — no real-time cross-module integration.
- **Payroll:** Completely unimplemented — returns empty stub.
- **Attendance:** Completely unimplemented — returns empty stub.

### Deployment Notes

- **Development:** `npm run dev` → `wrangler dev --port 5000 --ip 0.0.0.0 --local`
- **Staging:** `npm run deploy:staging` (requires CLOUDFLARE_API_TOKEN + staging D1/KV IDs)
- **Production:** `npm run deploy` (requires CLOUDFLARE_API_TOKEN + prod D1/KV IDs)
- **Secrets needed:** `JWT_SECRET`, `INTER_SERVICE_SECRET`, `AI_PLATFORM_TOKEN`

### Document Maintenance

This document should be updated when:
- New modules are added to this repo
- `@webwaka/core` major version is released (check for new primitives)
- Tasks are completed (mark them done in the task table)
- New bugs are discovered
- The platform Blueprint changes

---

*End of WEBWAKA-CROSS-CUTTING-DEEP-RESEARCH-TASKBOOK.md*

*Document length: ~250KB of structured research, analysis, task definitions, QA plans, and copy-paste prompts.*
*Tasks defined: 26 (T01–T26), QA plans: 20, Implementation prompts: 14 detailed, QA prompts: 9 detailed.*
*Phase 1: 17 tasks | Phase 2: 9 tasks*
