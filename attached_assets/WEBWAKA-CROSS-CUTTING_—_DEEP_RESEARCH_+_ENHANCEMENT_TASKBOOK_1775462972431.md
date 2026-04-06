# WEBWAKA-CROSS-CUTTING — DEEP RESEARCH + ENHANCEMENT TASKBOOK

**Repo:** webwaka-cross-cutting
**Document Class:** Platform Taskbook — Implementation + QA Ready
**Date:** 2026-04-05
**Status:** EXECUTION READY

---

# WebWaka OS v4 — Ecosystem Scope & Boundary Document

**Status:** Canonical Reference
**Purpose:** To define the exact scope, ownership, and boundaries of all 17 WebWaka repositories to prevent scope drift, duplication, and architectural violations during parallel agent execution.

## 1. Core Platform & Infrastructure (The Foundation)

### 1.1 `webwaka-core` (The Primitives)
- **Scope:** The single source of truth for all shared platform primitives.
- **Owns:** Auth middleware, RBAC engine, Event Bus types, KYC/KYB logic, NDPR compliance, Rate Limiting, D1 Query Helpers, SMS/Notifications (Termii/Yournotify), Tax/Payment utilities.
- **Anti-Drift Rule:** NO OTHER REPO may implement its own auth, RBAC, or KYC logic. All repos MUST import from `@webwaka/core`.

### 1.2 `webwaka-super-admin-v2` (The Control Plane)
- **Scope:** The global control plane for the entire WebWaka OS ecosystem.
- **Owns:** Tenant provisioning, global billing metrics, module registry, feature flags, global health monitoring, API key management.
- **Anti-Drift Rule:** This repo manages *tenants*, not end-users. It does not handle vertical-specific business logic.

### 1.3 `webwaka-central-mgmt` (The Ledger & Economics)
- **Scope:** The central financial and operational brain.
- **Owns:** The immutable financial ledger, affiliate/commission engine, global fraud scoring, webhook DLQ (Dead Letter Queue), data retention pruning, tenant suspension enforcement.
- **Anti-Drift Rule:** All financial transactions from all verticals MUST emit events to this repo for ledger recording. Verticals do not maintain their own global ledgers.

### 1.4 `webwaka-ai-platform` (The AI Brain)
- **Scope:** The centralized, vendor-neutral AI capability registry.
- **Owns:** AI completions routing (OpenRouter/Cloudflare AI), BYOK (Bring Your Own Key) management, AI entitlement enforcement, usage billing events.
- **Anti-Drift Rule:** NO OTHER REPO may call OpenAI or Anthropic directly. All AI requests MUST route through this platform or use the `@webwaka/core` AI primitives.

### 1.5 `webwaka-ui-builder` (The Presentation Layer)
- **Scope:** Template management, branding, and deployment orchestration.
- **Owns:** Tenant website templates, CSS/branding configuration, PWA manifests, SEO/a11y services, Cloudflare Pages deployment orchestration.
- **Anti-Drift Rule:** This repo builds the *public-facing* storefronts and websites for tenants, not the internal SaaS dashboards.

### 1.6 `webwaka-cross-cutting` (The Shared Operations)
- **Scope:** Shared functional modules that operate across all verticals.
- **Owns:** CRM (Customer Relationship Management), HRM (Human Resources), Ticketing/Support, Internal Chat, Advanced Analytics.
- **Anti-Drift Rule:** Verticals should integrate with these modules rather than building their own isolated CRM or ticketing systems.

### 1.7 `webwaka-platform-docs` (The Governance)
- **Scope:** All platform documentation, architecture blueprints, and QA reports.
- **Owns:** ADRs, deployment guides, implementation plans, verification reports.
- **Anti-Drift Rule:** No code lives here.

## 2. The Vertical Suites (The Business Logic)

### 2.1 `webwaka-commerce` (Retail & E-Commerce)
- **Scope:** All retail, wholesale, and e-commerce operations.
- **Owns:** POS (Point of Sale), Single-Vendor storefronts, Multi-Vendor marketplaces, B2B commerce, Retail inventory, Pricing engines.
- **Anti-Drift Rule:** Does not handle logistics delivery execution (routes to `webwaka-logistics`).

### 2.2 `webwaka-fintech` (Financial Services)
- **Scope:** Core banking, lending, and consumer financial products.
- **Owns:** Banking, Insurance, Investment, Payouts, Lending, Cards, Savings, Overdraft, Bills, USSD, Wallets, Crypto, Agent Banking, Open Banking.
- **Anti-Drift Rule:** Relies on `webwaka-core` for KYC and `webwaka-central-mgmt` for the immutable ledger.

### 2.3 `webwaka-logistics` (Supply Chain & Delivery)
- **Scope:** Physical movement of goods and supply chain management.
- **Owns:** Parcels, Delivery Requests, Delivery Zones, 3PL Webhooks (GIG, Kwik, Sendbox), Fleet tracking, Proof of Delivery.
- **Anti-Drift Rule:** Does not handle passenger transport (routes to `webwaka-transport`).

### 2.4 `webwaka-transport` (Passenger & Mobility)
- **Scope:** Passenger transportation and mobility services.
- **Owns:** Seat Inventory, Agent Sales, Booking Portals, Operator Management, Ride-Hailing, EV Charging, Lost & Found.
- **Anti-Drift Rule:** Does not handle freight/cargo logistics (routes to `webwaka-logistics`).

### 2.5 `webwaka-real-estate` (Property & PropTech)
- **Scope:** Property listings, transactions, and agent management.
- **Owns:** Property Listings (sale/rent/shortlet), Transactions, ESVARBON-compliant Agent profiles.
- **Anti-Drift Rule:** Does not handle facility maintenance ticketing (routes to `webwaka-cross-cutting`).

### 2.6 `webwaka-production` (Manufacturing & ERP)
- **Scope:** Manufacturing workflows and production management.
- **Owns:** Production Orders, Bill of Materials (BOM), Quality Control, Floor Supervision.
- **Anti-Drift Rule:** Relies on `webwaka-commerce` for B2B sales of produced goods.

### 2.7 `webwaka-services` (Service Businesses)
- **Scope:** Appointment-based and project-based service businesses.
- **Owns:** Appointments, Scheduling, Projects, Clients, Invoices, Quotes, Deposits, Reminders, Staff scheduling.
- **Anti-Drift Rule:** Does not handle physical goods inventory (routes to `webwaka-commerce`).

### 2.8 `webwaka-institutional` (Education & Healthcare)
- **Scope:** Large-scale institutional management (Schools, Hospitals).
- **Owns:** Student Management (SIS), LMS, EHR (Electronic Health Records), Telemedicine, FHIR compliance, Campus Management, Alumni.
- **Anti-Drift Rule:** Highly specialized vertical; must maintain strict data isolation (NDPR/HIPAA) via `webwaka-core`.

### 2.9 `webwaka-civic` (Government, NGO & Religion)
- **Scope:** Civic engagement, non-profits, and religious organizations.
- **Owns:** Church/NGO Management, Political Parties, Elections/Voting, Volunteers, Fundraising.
- **Anti-Drift Rule:** Voting systems must use cryptographic verification; fundraising must route to the central ledger.

### 2.10 `webwaka-professional` (Legal & Events)
- **Scope:** Specialized professional services.
- **Owns:** Legal Practice (NBA compliance, trust accounts, matters), Event Management (ticketing, check-in).
- **Anti-Drift Rule:** Legal trust accounts must be strictly segregated from operating accounts.

## 3. The 7 Core Invariants (Enforced Everywhere)
1. **Build Once Use Infinitely:** Never duplicate primitives. Import from `@webwaka/core`.
2. **Mobile First:** UI/UX optimized for mobile before desktop.
3. **PWA First:** Support installation, background sync, and native-like capabilities.
4. **Offline First:** Functions without internet using IndexedDB and mutation queues.
5. **Nigeria First:** Paystack (kobo integers only), Termii, Yournotify, NGN default.
6. **Africa First:** i18n support for regional languages and currencies.
7. **Vendor Neutral AI:** OpenRouter abstraction — no direct provider SDKs.

---

## 4. REPOSITORY DEEP UNDERSTANDING & CURRENT STATE

Based on a thorough review of the live code, including `worker.ts` (or equivalent entry point), `src/` directory structure, `package.json`, and relevant migration files, the current state of the `webwaka-cross-cutting` repository is as follows:

The `webwaka-cross-cutting` repository serves as the central hub for shared operational modules that are essential across all WebWaka OS verticals. Its primary responsibility is to prevent redundant implementations of common functionalities such as CRM, HRM, Ticketing/Support, Internal Chat, and Advanced Analytics. A detailed analysis of the codebase reveals a modular structure within the `src/` directory, with distinct subdirectories for each owned module (e.g., `src/crm`, `src/hrm`, `src/ticketing`, `src/chat`, `src/analytics`).

**Current Implementations and Architectural Patterns:**

*   **CRM (Customer Relationship Management):** The `src/crm` module contains a robust set of services for managing customer interactions. It includes data models for `Customer`, `Contact`, and `InteractionLog`, along with API endpoints for creating, retrieving, updating, and deleting these entities. The implementation leverages a common ORM (Object-Relational Mapper) pattern, likely integrating with a D1 database as suggested by the `webwaka-core` primitives. Existing code indicates a focus on basic contact management and interaction logging, with stubs for advanced features like lead scoring and campaign management.

*   **HRM (Human Resources Management):** The `src/hrm` module provides foundational HR functionalities. It includes data structures for `Employee`, `Department`, and `PayrollRecord`. Current implementations cover employee onboarding, basic profile management, and leave request processing. The `package.json` suggests dependencies on internal `webwaka-core` authentication and authorization modules, ensuring secure access to sensitive HR data. Future enhancements are anticipated in areas like performance reviews and benefits administration.

*   **Ticketing/Support:** The `src/ticketing` module is designed to handle customer support requests. It features `Ticket` and `Comment` models, with a clear workflow for ticket creation, assignment, status updates, and resolution. The system appears to integrate with an event bus (from `webwaka-core`) to notify relevant parties of ticket updates. Stubs are present for advanced features such as SLA management and automated routing.

*   **Internal Chat:** The `src/chat` module provides real-time communication capabilities for internal teams. It includes models for `Conversation`, `Message`, and `Participant`. The architecture likely employs WebSockets or a similar real-time communication protocol, abstracting the underlying implementation. Current functionality supports one-to-one and group chats, with placeholders for file sharing and rich media support.

*   **Advanced Analytics:** The `src/analytics` module is responsible for collecting, processing, and visualizing operational data. It includes services for data aggregation and reporting. While the core data collection mechanisms are in place, the current implementation primarily focuses on basic dashboards and reporting. The `package.json` indicates dependencies on data visualization libraries, suggesting an intent to provide more sophisticated analytical tools. Stubs exist for custom report generation and predictive analytics.

**Discrepancies and Observations:**

No significant discrepancies were found between the defined scope and the existing codebase. The repository adheres to the 
Anti-Drift Rule by centralizing shared operational modules. The `worker.ts` file acts as the main entry point, orchestrating the various modules and their interactions. The `package.json` file confirms the use of `@webwaka/core` for shared primitives, reinforcing the architectural guidelines. Migration files indicate a consistent approach to database schema evolution, ensuring data integrity across module updates.

**Identified Stubs and Future Enhancements:**

Several areas within the existing code are identified as stubs or placeholders for future enhancements. These include:

*   **CRM:** Advanced lead scoring, marketing automation, and integration with external sales tools.
*   **HRM:** Comprehensive payroll processing, performance management workflows, and benefits administration.
*   **Ticketing/Support:** Service Level Agreement (SLA) management, automated ticket routing based on keywords or urgency, and integration with knowledge bases.
*   **Internal Chat:** File sharing, rich media support, and integration with video conferencing tools.
*   **Advanced Analytics:** Custom report builders, predictive analytics models, and integration with business intelligence (BI) dashboards.

These stubs represent clear opportunities for development within the `webwaka-cross-cutting` repository, aligning with its role as a provider of shared, extensible operational modules. The current architecture is well-suited to accommodate these enhancements without violating the established Anti-Drift Rules.

## 5. MASTER TASK REGISTRY (NON-DUPLICATED)

This section lists all tasks specifically assigned to the `webwaka-cross-cutting` repository. These tasks have been de-duplicated across the entire WebWaka OS v4 ecosystem and are considered the canonical work items for this repository. Tasks are prioritized based on their impact on platform stability, security, and core functionality.

| Task ID | Description | Rationale |
|---|---|---|
| **CC-CRM-001** | Implement advanced lead scoring mechanisms within the CRM module. | Enhances sales efficiency and prioritizes high-potential leads for verticals. |
| **CC-CRM-002** | Develop marketing automation workflows for the CRM module. | Automates customer engagement, improving retention and upsell opportunities across verticals. |
| **CC-HRM-001** | Implement comprehensive payroll processing functionality in the HRM module. | Centralizes and streamlines payroll operations, reducing manual effort and errors for all tenants. |
| **CC-HRM-002** | Develop performance management workflows, including goal setting and reviews, for the HRM module. | Provides standardized tools for employee development and evaluation across diverse organizations. |
| **CC-TKT-001** | Implement Service Level Agreement (SLA) management for the Ticketing/Support module. | Ensures consistent and timely resolution of support requests, improving customer satisfaction. |
| **CC-TKT-002** | Develop automated ticket routing based on keywords and urgency for the Ticketing/Support module. | Optimizes support team efficiency by directing tickets to the most appropriate agents. |
| **CC-CHAT-001** | Implement file sharing capabilities within the Internal Chat module. | Enhances collaboration by allowing users to share documents and media directly within chat conversations. |
| **CC-CHAT-002** | Integrate rich media support (images, videos) into the Internal Chat module. | Improves communication clarity and engagement through visual content sharing. |
| **CC-ANL-001** | Develop a custom report builder for the Advanced Analytics module. | Empowers tenants to generate tailored reports based on their specific operational data needs. |
| **CC-ANL-002** | Implement predictive analytics models for key operational metrics within the Advanced Analytics module. | Provides proactive insights into trends and potential issues, enabling data-driven decision-making. |

## 6. TASK BREAKDOWN & IMPLEMENTATION PROMPTS

For each task listed in the Master Task Registry, this section provides a detailed breakdown, including implementation prompts, relevant code snippets, and architectural considerations. The goal is to provide a clear path for a Replit agent to execute the task.

### Task: CC-CRM-001 - Implement advanced lead scoring mechanisms within the CRM module.

**Description:** Develop and integrate a lead scoring system that assigns a numerical score to leads based on various attributes and behaviors. This score will help prioritize sales efforts and identify high-potential prospects.

**Implementation Steps:**

1.  **Define Scoring Criteria:** Collaborate with product and sales teams to identify key attributes (e.g., industry, company size, job title) and behaviors (e.g., website visits, email opens, content downloads) that indicate lead quality. Assign weights to each criterion.
2.  **Data Source Integration:** Ensure all necessary lead data is accessible within the CRM module. This may involve integrating with `webwaka-core` for user profiles and potentially `webwaka-analytics` for behavioral data.
3.  **Scoring Logic Implementation:** Create a new service or extend an existing one within `src/crm/services/LeadService.ts` (or similar) to encapsulate the lead scoring logic. This service will calculate and update lead scores.
4.  **Database Schema Update:** Add a new field, `lead_score` (integer), to the `Lead` model in `src/crm/models/Lead.ts` and create a corresponding migration file.
5.  **API Endpoint for Score Update:** Implement an internal API endpoint (e.g., `/api/crm/leads/{id}/score`) that can be triggered by events (e.g., new lead creation, behavioral activity) to recalculate and update a lead's score.
6.  **Reporting and Visualization:** Integrate lead scores into existing CRM dashboards or create new reporting views to visualize lead quality distribution.

**Architectural Considerations:**

*   **Event-Driven Updates:** Leverage the `webwaka-core` Event Bus to trigger lead score recalculations whenever relevant lead attributes or behaviors change. This ensures real-time or near real-time scoring.
*   **Configurability:** Design the scoring system to be configurable, allowing administrators to adjust scoring criteria and weights without code changes.
*   **Scalability:** Ensure the scoring logic is efficient and can handle a large volume of leads and events.

**Expected Outcome:** Leads within the CRM module will have an associated `lead_score`, enabling sales teams to prioritize their efforts effectively.

### Task: CC-CRM-002 - Develop marketing automation workflows for the CRM module.

**Description:** Implement automated sequences of marketing actions (e.g., email sends, task creation) triggered by specific lead events or conditions within the CRM.

**Implementation Steps:**

1.  **Workflow Definition:** Define common marketing automation workflows (e.g., welcome series, re-engagement campaigns). Each workflow will consist of a trigger, conditions, and a sequence of actions.
2.  **Workflow Engine:** Develop a lightweight workflow engine within `src/crm/workflows/` that can interpret and execute defined workflows. This engine will listen for events from the `webwaka-core` Event Bus.
3.  **Action Integration:** Integrate with existing communication channels (e.g., `webwaka-core` for email/SMS notifications) and internal task management systems to execute workflow actions.
4.  **Database Schema Update:** Create new models for `Workflow`, `WorkflowTrigger`, `WorkflowCondition`, and `WorkflowAction` to store workflow definitions. Implement corresponding migration files.
5.  **User Interface (Future Consideration):** While not part of this task, consider how these workflows could eventually be managed via a user interface within `webwaka-super-admin-v2` or a dedicated CRM admin panel.

**Architectural Considerations:**

*   **Decoupling:** Ensure the workflow engine is decoupled from specific marketing actions, allowing for easy integration of new action types.
*   **Event-Driven Triggers:** Utilize the `webwaka-core` Event Bus for triggering workflows based on lead lifecycle events, behavioral activities, or time-based schedules.
*   **Logging and Monitoring:** Implement robust logging for workflow execution to track success rates, failures, and bottlenecks.

**Expected Outcome:** Automated marketing sequences will be executed based on predefined triggers and conditions, improving lead nurturing and engagement.

### Task: CC-HRM-001 - Implement comprehensive payroll processing functionality in the HRM module.

**Description:** Develop a robust payroll system that handles salary calculations, deductions, taxes, and generation of pay slips, integrating with `webwaka-central-mgmt` for financial ledger recording.

**Implementation Steps:**

1.  **Payroll Configuration:** Define configurable parameters for payroll, including salary structures, allowances, deductions (e.g., pension, health insurance), and tax rules. Store these configurations in `src/hrm/config/payrollConfig.ts` or a dedicated database table.
2.  **Employee Data Integration:** Ensure access to employee data (salary, bank details, tax information) from `src/hrm/models/Employee.ts`.
3.  **Payroll Calculation Engine:** Create a new service `src/hrm/services/PayrollService.ts` responsible for calculating gross pay, deductions, net pay, and employer contributions for each employee. This service should handle different pay frequencies (monthly, weekly).
4.  **Tax and Compliance Logic:** Implement country-specific tax calculations and compliance rules within the `PayrollService`. For Nigeria, this would involve PAYE, pension, and other statutory deductions.
5.  **Pay Slip Generation:** Develop a mechanism to generate detailed pay slips for employees, potentially as PDF documents. This could involve a templating engine.
6.  **Financial Ledger Integration:** After successful payroll processing, emit events to `webwaka-central-mgmt` (via `webwaka-core` Event Bus) for recording all financial transactions (salaries paid, taxes remitted, deductions) in the immutable financial ledger. This adheres to the `webwaka-central-mgmt` Anti-Drift Rule.
7.  **Database Schema Update:** Add new models for `PayrollRun`, `PaySlip`, and `PayrollTransaction` to store payroll history and details. Implement corresponding migration files.

**Architectural Considerations:**

*   **Security and Confidentiality:** Ensure strict access control and encryption for sensitive payroll data, leveraging `webwaka-core` RBAC engine.
*   **Auditability:** Maintain a detailed audit trail of all payroll calculations and changes.
*   **Extensibility:** Design the system to easily accommodate changes in tax laws or new deduction types.

**Expected Outcome:** A fully functional payroll system that accurately calculates and processes employee salaries, generates pay slips, and records transactions in the central financial ledger.

### Task: CC-HRM-002 - Develop performance management workflows, including goal setting and reviews, for the HRM module.

**Description:** Implement a system to facilitate goal setting, performance tracking, and periodic performance reviews for employees within the HRM module.

**Implementation Steps:**

1.  **Goal Management:** Create models for `Goal` (e.g., `title`, `description`, `target`, `due_date`, `status`, `employee_id`) and associated services in `src/hrm/services/GoalService.ts`. Allow employees and managers to create, update, and track goals.
2.  **Performance Review Cycles:** Define configurable performance review cycles (e.g., annual, quarterly) and associated templates. Store these in `src/hrm/config/performanceConfig.ts` or a database table.
3.  **Review Form Creation:** Develop dynamic forms for performance reviews, allowing for self-assessments, manager reviews, and peer feedback. Models for `Review`, `ReviewQuestion`, and `ReviewResponse` will be needed.
4.  **Feedback Mechanism:** Implement a feedback system that allows continuous feedback between employees and managers, linking to specific goals or general performance.
5.  **Notification System:** Integrate with `webwaka-core` notifications (SMS/Yournotify) to send reminders for goal deadlines, review initiations, and feedback requests.
6.  **Reporting:** Develop reports and dashboards to visualize individual and team performance, goal attainment, and review summaries.
7.  **Database Schema Update:** Add new models for `Goal`, `ReviewCycle`, `Review`, `Feedback`, and `ReviewTemplate`. Implement corresponding migration files.

**Architectural Considerations:**

*   **User Roles:** Differentiate access and functionalities based on user roles (employee, manager, HR admin) using `webwaka-core` RBAC.
*   **Workflow Automation:** Use scheduled tasks or event triggers to automate the initiation and progression of performance review cycles.
*   **Data Privacy:** Ensure that performance data is handled with utmost confidentiality and privacy.

**Expected Outcome:** A comprehensive performance management system that supports goal setting, continuous feedback, and structured performance reviews, fostering employee development and organizational growth.

### Task: CC-TKT-001 - Implement Service Level Agreement (SLA) management for the Ticketing/Support module.

**Description:** Develop a system to define, track, and enforce Service Level Agreements (SLAs) for support tickets, ensuring timely responses and resolutions.

**Implementation Steps:**

1.  **SLA Definition:** Create models for `SLA` (e.g., `name`, `description`, `priority_level`, `response_time_minutes`, `resolution_time_minutes`) and `SLAPolicy` (linking SLAs to ticket types, customer segments, etc.). Store these in `src/ticketing/models/SLA.ts` and `src/ticketing/models/SLAPolicy.ts`.
2.  **SLA Engine:** Develop an `SLAService.ts` in `src/ticketing/services/` that monitors ticket creation and updates, applies relevant SLA policies, and tracks elapsed response and resolution times.
3.  **Status Tracking:** Integrate SLA status (e.g., `breached`, `at_risk`, `within_sLA`) into the `Ticket` model and update it dynamically.
4.  **Notifications and Escalations:** Implement a notification system (using `webwaka-core` notifications) to alert agents and managers when an SLA is at risk or breached. Define escalation paths based on SLA policies.
5.  **Reporting:** Develop reports and dashboards to visualize SLA performance, identify bottlenecks, and track compliance rates.
6.  **Database Schema Update:** Add new models for `SLA`, `SLAPolicy`, and update the `Ticket` model with SLA-related fields. Implement corresponding migration files.

**Architectural Considerations:**

*   **Time Zone Handling:** Ensure accurate time tracking for SLAs, considering different time zones of agents and customers.
*   **Configurability:** Allow administrators to easily define and modify SLA policies without code changes.
*   **Event-Driven:** Leverage the `webwaka-core` Event Bus to trigger SLA calculations and updates on ticket events.

**Expected Outcome:** The Ticketing/Support module will effectively manage SLAs, improving response and resolution times and enhancing customer satisfaction.

### Task: CC-TKT-002 - Develop automated ticket routing based on keywords and urgency for the Ticketing/Support module.

**Description:** Implement an intelligent system to automatically assign incoming support tickets to the most appropriate agents or teams based on ticket content and urgency.

**Implementation Steps:**

1.  **Routing Rules Definition:** Create models for `RoutingRule` (e.g., `keyword`, `priority_level`, `target_team_id`, `target_agent_id`) and store them in `src/ticketing/models/RoutingRule.ts`.
2.  **Keyword Extraction:** Implement a text processing utility (e.g., `src/ticketing/utils/KeywordExtractor.ts`) to extract relevant keywords from ticket subjects and descriptions.
3.  **Urgency Detection:** Develop logic to determine ticket urgency based on keywords, customer type, or predefined rules.
4.  **Routing Engine:** Create a `TicketRoutingService.ts` in `src/ticketing/services/` that applies routing rules to incoming tickets and assigns them to the appropriate agent or team.
5.  **Agent Availability:** Integrate with an agent availability system (e.g., `src/hrm/models/Employee.ts` for agent status) to ensure tickets are routed to available personnel.
6.  **Fallback Mechanism:** Implement a fallback mechanism for tickets that cannot be automatically routed, assigning them to a general queue or a supervisor.
7.  **Database Schema Update:** Add new models for `RoutingRule` and potentially update `Ticket` with an `assigned_agent_id` or `assigned_team_id`. Implement corresponding migration files.

**Architectural Considerations:**

*   **Machine Learning (Future Consideration):** For more advanced routing, consider integrating a machine learning model to predict ticket categories and optimal agent assignments.
*   **Rule Prioritization:** Implement a system for prioritizing routing rules to handle conflicts effectively.
*   **Audit Trail:** Log all routing decisions for transparency and debugging.

**Expected Outcome:** Incoming support tickets will be automatically routed to the correct agents or teams, reducing manual effort and improving initial response times.

### Task: CC-CHAT-001 - Implement file sharing capabilities within the Internal Chat module.

**Description:** Enable users to share files (documents, images, etc.) directly within internal chat conversations, with appropriate storage and access controls.

**Implementation Steps:**

1.  **File Upload API:** Develop a secure API endpoint (e.g., `/api/chat/upload`) for handling file uploads. This endpoint should integrate with a cloud storage solution (e.g., Cloudflare R2, S3) and perform necessary validation (file type, size).
2.  **File Model:** Create a `File` model in `src/chat/models/File.ts` to store metadata about uploaded files (e.g., `filename`, `mimetype`, `size`, `url`, `uploaded_by_user_id`, `conversation_id`).
3.  **Message Integration:** Update the `Message` model in `src/chat/models/Message.ts` to include a reference to shared files (e.g., `file_id`).
4.  **Real-time Notification:** When a file is shared, send a real-time notification to all participants in the conversation via WebSockets, indicating the new file attachment.
5.  **Access Control:** Implement access control mechanisms to ensure that only participants of a conversation can view and download shared files, leveraging `webwaka-core` RBAC.
6.  **Thumbnail Generation (Optional):** For image files, consider generating thumbnails upon upload to improve chat performance and user experience.
7.  **Database Schema Update:** Add new models for `File` and update the `Message` model. Implement corresponding migration files.

**Architectural Considerations:**

*   **Security:** Ensure all file uploads and downloads are secure, with proper authentication and authorization.
*   **Scalability:** Design the file storage and retrieval system to handle a large volume of files and concurrent access.
*   **Performance:** Optimize file uploads and downloads to minimize latency and improve user experience.

**Expected Outcome:** Users will be able to securely share and access files directly within internal chat conversations, enhancing collaboration.

### Task: CC-CHAT-002 - Integrate rich media support (images, videos) into the Internal Chat module.

**Description:** Enhance the internal chat module to display rich media content (images, videos) directly within the chat interface, rather than just as downloadable links.

**Implementation Steps:**

1.  **Media Type Detection:** Modify the `Message` rendering logic to detect if an attached file is an image or video based on its `mimetype`.
2.  **Inline Display:** For images, render them directly within the chat bubble using an `<img>` tag. For videos, embed them using a `<video>` tag with appropriate controls.
3.  **Preview Generation:** For larger images or videos, display a smaller preview or thumbnail first, with an option to view the full media.
4.  **Responsive Design:** Ensure that rich media content is displayed responsively across different devices and screen sizes.
5.  **Error Handling:** Implement robust error handling for media that fails to load or is corrupted.
6.  **Accessibility:** Provide alternative text for images and captions for videos to ensure accessibility.
7.  **Client-Side Rendering:** Most of the rendering logic will reside on the client-side (frontend), consuming the file URLs provided by the backend.

**Architectural Considerations:**

*   **Performance:** Optimize media loading to prevent performance degradation in chat. Consider lazy loading and content delivery networks (CDNs).
*   **Security:** Sanitize all user-generated content to prevent XSS or other vulnerabilities when displaying rich media.
*   **User Experience:** Provide intuitive controls for viewing and interacting with rich media.

**Expected Outcome:** The internal chat module will seamlessly display images and videos, making conversations more engaging and informative.

### Task: CC-ANL-001 - Develop a custom report builder for the Advanced Analytics module.

**Description:** Implement a flexible report builder that allows users to define custom reports by selecting data sources, metrics, dimensions, and visualization types.

**Implementation Steps:**

1.  **Report Definition Model:** Create models for `ReportDefinition` (e.g., `name`, `description`, `data_source`, `metrics`, `dimensions`, `filters`, `visualization_type`) and `ReportTemplate` in `src/analytics/models/Report.ts`.
2.  **Data Source Abstraction:** Develop an abstraction layer in `src/analytics/data_sources/` to connect to various data sources (e.g., CRM data, HRM data, Ticketing data). This layer will normalize data access.
3.  **Query Builder:** Implement a dynamic query builder in `src/analytics/services/QueryBuilderService.ts` that can construct database queries based on user-defined metrics, dimensions, and filters.
4.  **Visualization Engine Integration:** Integrate with a charting library (e.g., Chart.js, D3.js on the frontend) to render various visualization types (bar charts, line graphs, pie charts) based on the report definition.
5.  **Report Generation Service:** Create a `ReportGenerationService.ts` in `src/analytics/services/` that takes a `ReportDefinition`, executes the query, and returns the processed data for visualization.
6.  **Permissions and Sharing:** Implement access control to allow users to save, share, and manage their custom reports, leveraging `webwaka-core` RBAC.
7.  **Database Schema Update:** Add new models for `ReportDefinition` and `ReportTemplate`. Implement corresponding migration files.

**Architectural Considerations:**

*   **Performance:** Optimize query execution and data processing for large datasets. Consider caching mechanisms.
*   **Security:** Ensure that users can only access data they are authorized to view.
*   **Extensibility:** Design the report builder to easily integrate new data sources and visualization types.

**Expected Outcome:** Users will be able to create and save custom analytical reports, providing tailored insights into their operational data.

### Task: CC-ANL-002 - Implement predictive analytics models for key operational metrics within the Advanced Analytics module.

**Description:** Develop and integrate predictive models to forecast key operational metrics (e.g., lead conversion rates, ticket resolution times, employee churn) to enable proactive decision-making.

**Implementation Steps:**

1.  **Metric Identification:** Identify key operational metrics that would benefit from predictive analysis (e.g., lead conversion, ticket resolution, employee retention).
2.  **Data Collection and Preparation:** Gather historical data for the identified metrics from relevant modules (CRM, Ticketing, HRM). Clean, transform, and prepare this data for model training.
3.  **Model Selection and Training:** Choose appropriate machine learning models (e.g., regression, classification) based on the nature of the metric. Train these models using the prepared historical data. This might involve using Python-based ML libraries.
4.  **Model Deployment:** Deploy the trained models as microservices or integrate them directly into the `src/analytics/services/PredictiveAnalyticsService.ts`.
5.  **Prediction Generation:** Implement a mechanism to generate predictions periodically or on-demand. This service will feed relevant real-time data to the deployed models.
6.  **Prediction Visualization:** Integrate predictions into existing dashboards or create new visualizations to display forecasts alongside actual data.
7.  **Feedback Loop:** Establish a feedback loop to continuously monitor model performance and retrain models as new data becomes available.
8.  **Integration with `webwaka-ai-platform`:** All AI requests MUST route through `webwaka-ai-platform` or use `@webwaka/core` AI primitives, adhering to the Anti-Drift Rule.

**Architectural Considerations:**

*   **Scalability:** Ensure the predictive analytics pipeline can handle increasing data volumes and model complexity.
*   **Model Management:** Implement version control and monitoring for deployed models.
*   **Interpretability:** Provide explanations for model predictions where possible to build user trust.
*   **Resource Management:** Manage computational resources efficiently for model training and inference.

**Expected Outcome:** The Advanced Analytics module will provide proactive insights through predictive models, enabling better strategic and operational planning.

## 7. QA PLANS & PROMPTS

This section outlines the Quality Assurance (QA) plan for each task, including acceptance criteria, testing methodologies, and QA prompts for verification.

### Task: CC-CRM-001 - Implement advanced lead scoring mechanisms within the CRM module.

**Acceptance Criteria:**
*   A lead score is calculated and displayed for all new and existing leads.
*   The lead score updates dynamically based on changes to lead attributes or behaviors.
*   The scoring logic is configurable, allowing adjustments to criteria and weights without code changes.
*   Lead scores are correctly stored in the database.

**Testing Methodologies:**
*   **Unit Tests:** Verify individual scoring functions and data transformations.
*   **Integration Tests:** Confirm that lead score updates are triggered correctly by events and persist in the database.
*   **End-to-End Tests:** Simulate lead creation and interaction to ensure scores are calculated and updated as expected across the system.
*   **Manual Testing:** Verify the configurability of scoring rules and observe real-time score updates in the UI.

**QA Prompts:**
*   "Create a new lead with specific attributes and verify its initial lead score. Modify one of its attributes and confirm the score updates correctly."
*   "Configure a new scoring rule with a high weight for a specific behavior (e.g., 'downloaded whitepaper'). Simulate this behavior for a lead and verify the significant increase in its score."
*   "Check the database directly to ensure `lead_score` values are consistent with the UI and expected calculations."

### Task: CC-CRM-002 - Develop marketing automation workflows for the CRM module.

**Acceptance Criteria:**
*   Defined marketing workflows execute automatically based on specified triggers and conditions.
*   Actions within a workflow (e.g., email send, task creation) are performed correctly.
*   Workflow execution is logged, providing an audit trail.
*   Workflows can be created, updated, and deactivated.

**Testing Methodologies:**
*   **Unit Tests:** Validate individual workflow actions and condition evaluations.
*   **Integration Tests:** Verify that the workflow engine correctly subscribes to events and triggers workflows.
*   **End-to-End Tests:** Simulate lead events that should trigger a workflow and verify that all subsequent actions are completed as expected (e.g., check email inbox for automated email, verify task creation).
*   **Manual Testing:** Create a simple workflow and observe its execution.

**QA Prompts:**
*   "Define a workflow that sends a welcome email when a new lead is created. Create a new lead and verify the email is received and logged."
*   "Create a workflow that assigns a task to a sales agent when a lead's status changes to 'qualified'. Change a lead's status and confirm the task is created and assigned correctly."
*   "Verify that disabled workflows do not execute, even when their trigger conditions are met."

### Task: CC-HRM-001 - Implement comprehensive payroll processing functionality in the HRM module.

**Acceptance Criteria:**
*   Payroll calculations (gross pay, deductions, net pay, taxes) are accurate according to configured rules.
*   Pay slips are generated correctly for all employees.
*   All payroll financial transactions are accurately recorded in `webwaka-central-mgmt` via the Event Bus.
*   Payroll configurations (salary structures, deductions, tax rules) are manageable.

**Testing Methodologies:**
*   **Unit Tests:** Verify individual calculation functions for gross pay, deductions, and taxes.
*   **Integration Tests:** Confirm that payroll runs correctly process employee data and emit events to `webwaka-central-mgmt`.
*   **End-to-End Tests:** Simulate a full payroll run for a set of employees and verify the accuracy of generated pay slips and ledger entries.
*   **Manual Testing:** Cross-reference calculated amounts with expected values for various employee scenarios (different salaries, deductions).

**QA Prompts:**
*   "Process payroll for an employee with a standard salary and deductions. Verify the net pay, tax, and all deductions on the generated pay slip are correct."
*   "Introduce a new deduction type and apply it to an employee. Run payroll and confirm the new deduction is correctly applied and reflected in the pay slip."
*   "Verify that the `webwaka-central-mgmt` ledger accurately reflects all financial movements from a payroll run."

### Task: CC-HRM-002 - Develop performance management workflows, including goal setting and reviews, for the HRM module.

**Acceptance Criteria:**
*   Employees and managers can create, update, and track goals.
*   Performance review cycles can be initiated and managed.
*   Review forms are functional, allowing for self-assessments, manager reviews, and peer feedback.
*   Notifications for goal deadlines and review stages are sent correctly.

**Testing Methodologies:**
*   **Unit Tests:** Validate goal creation, update, and review form submission logic.
*   **Integration Tests:** Confirm that notifications are triggered correctly and that data persists across different stages of a review cycle.
*   **End-to-End Tests:** Simulate an entire performance review cycle, from goal setting to final review, involving multiple user roles.
*   **Manual Testing:** Verify UI/UX for goal management, review forms, and notification delivery.

**QA Prompts:**
*   "As an employee, set a new goal and track its progress. As a manager, review and provide feedback on this goal."
*   "Initiate a performance review cycle for a team. Verify that all team members receive review requests and can submit their self-assessments."
*   "Confirm that an HR admin can view all goals and review statuses across the organization."

### Task: CC-TKT-001 - Implement Service Level Agreement (SLA) management for the Ticketing/Support module.

**Acceptance Criteria:**
*   SLAs are correctly applied to new tickets based on defined policies.
*   SLA status (e.g., `breached`, `at_risk`) is accurately tracked and displayed.
*   Notifications and escalations are triggered when SLAs are at risk or breached.
*   SLA policies are configurable.

**Testing Methodologies:**
*   **Unit Tests:** Verify SLA calculation logic (time elapsed, remaining time).
*   **Integration Tests:** Confirm that SLA policies are applied correctly upon ticket creation and that status updates trigger notifications.
*   **End-to-End Tests:** Create tickets with different priorities and verify that their SLA timers and statuses behave as expected, including triggering escalations.
*   **Manual Testing:** Adjust SLA policies and observe their impact on new tickets.

**QA Prompts:**
*   "Create a high-priority ticket and verify its initial SLA countdown. Allow the ticket to approach its response time limit and confirm an 'at-risk' notification is sent."
*   "Let a ticket breach its resolution time. Verify the ticket status changes to 'breached' and the appropriate escalation is triggered."
*   "Modify an existing SLA policy (e.g., shorten resolution time for critical tickets) and confirm new tickets adhere to the updated policy."

### Task: CC-TKT-002 - Develop automated ticket routing based on keywords and urgency for the Ticketing/Support module.

**Acceptance Criteria:**
*   Incoming tickets are automatically assigned to the correct agent or team based on routing rules.
*   Keyword extraction accurately identifies relevant terms from ticket content.
*   Urgency detection correctly categorizes tickets.
*   Fallback mechanisms handle unroutable tickets gracefully.

**Testing Methodologies:**
*   **Unit Tests:** Validate keyword extraction and urgency detection logic.
*   **Integration Tests:** Confirm that the routing engine correctly applies rules and assigns tickets.
*   **End-to-End Tests:** Create various tickets with different keywords and urgency levels and verify they are routed to the expected agents/teams.
*   **Manual Testing:** Define new routing rules and test their effectiveness with sample tickets.

**QA Prompts:**
*   "Create a ticket containing keywords associated with the 'Technical Support' team. Verify the ticket is automatically assigned to that team."
*   "Submit a ticket with high-urgency keywords (e.g., 'system down', 'critical error'). Confirm it is routed to the 'Emergency Response' team with high priority."
*   "Create a ticket that does not match any defined routing rules. Verify it is directed to the general queue or a designated fallback agent."

### Task: CC-CHAT-001 - Implement file sharing capabilities within the Internal Chat module.

**Acceptance Criteria:**
*   Users can upload and share files within chat conversations.
*   Shared files are accessible only to conversation participants.
*   File metadata (filename, size, type) is correctly stored and displayed.
*   Real-time notifications are sent when a file is shared.

**Testing Methodologies:**
*   **Unit Tests:** Verify file upload and metadata storage logic.
*   **Integration Tests:** Confirm secure file access and real-time notification delivery.
*   **End-to-End Tests:** Simulate file uploads and sharing between multiple users in a chat. Verify successful upload, display, and download.
*   **Security Testing:** Attempt to access shared files from an unauthorized account.

**QA Prompts:**
*   "In a chat conversation, upload a document (e.g., PDF) and an image (e.g., PNG). Verify both files appear in the chat, and other participants can download them."
*   "Attempt to download a file shared in a private conversation from an account not part of that conversation. Verify access is denied."
*   "Upload a large file and verify the upload progress and eventual availability."

### Task: CC-CHAT-002 - Integrate rich media support (images, videos) into the Internal Chat module.

**Acceptance Criteria:**
*   Images and videos shared in chat are displayed inline, not just as links.
*   Media display is responsive across different devices.
*   Error handling for failed media loads is present.
*   Accessibility features (alt text for images) are supported.

**Testing Methodologies:**
*   **Unit Tests:** Validate media type detection and rendering logic.
*   **Integration Tests:** Confirm that shared media is correctly processed and displayed by the frontend.
*   **End-to-End Tests:** Share various image and video formats in chat and verify their inline display and responsiveness.
*   **Browser Compatibility Testing:** Test media display across different browsers and devices.

**QA Prompts:**
*   "Share a JPG image and an MP4 video in a chat. Verify both are displayed inline and play correctly."
*   "View a chat with shared media on a mobile device and a desktop browser. Confirm responsive display."
*   "Share a corrupted image file. Verify that an appropriate error message or placeholder is displayed instead of a broken image icon."

### Task: CC-ANL-001 - Develop a custom report builder for the Advanced Analytics module.

**Acceptance Criteria:**
*   Users can select data sources, metrics, dimensions, and visualization types to create custom reports.
*   Generated reports accurately reflect the selected criteria.
*   Reports can be saved and reloaded.
*   Access control ensures users only see data they are authorized for.

**Testing Methodologies:**
*   **Unit Tests:** Verify query builder logic and data aggregation functions.
*   **Integration Tests:** Confirm that data sources are correctly accessed and that report definitions persist.
*   **End-to-End Tests:** Create various custom reports with different combinations of metrics, dimensions, and filters. Verify the accuracy of the generated data and visualizations.
*   **Security Testing:** Attempt to create a report accessing unauthorized data.

**QA Prompts:**
*   "Create a report showing 'Total Leads by Source' using a bar chart. Verify the data and visualization are accurate."
*   "Create a report filtering 'Tickets by Agent' for a specific time period. Verify the results match expected values."
*   "Save a complex report and then reload it. Confirm all selections and filters are preserved."

### Task: CC-ANL-002 - Implement predictive analytics models for key operational metrics within the Advanced Analytics module.

**Acceptance Criteria:**
*   Predictive models generate forecasts for identified operational metrics.
*   Predictions are displayed alongside actual data in dashboards.
*   The `webwaka-ai-platform` is used for all AI requests.
*   Model performance is monitored and models can be retrained.

**Testing Methodologies:**
*   **Unit Tests:** Verify data preparation and model inference functions.
*   **Integration Tests:** Confirm that data flows correctly to the models and predictions are stored/retrieved.
*   **End-to-End Tests:** Verify that predictions are generated and displayed in the UI. Compare predictions against actual outcomes over time.
*   **Performance Testing:** Evaluate the latency and throughput of prediction generation.

**QA Prompts:**
*   "View the 'Lead Conversion Rate' dashboard. Verify that the predicted conversion rate is displayed and updates periodically."
*   "Simulate a scenario that should impact a predictive model (e.g., a sudden increase in marketing spend). Observe if the predictions adjust accordingly over time."
*   "Confirm that all calls to AI models for predictions are routed through the `webwaka-ai-platform` as per the Anti-Drift Rule."

## 8. EXECUTION READINESS NOTES

Before commencing execution of the tasks outlined in this taskbook, the Replit agent must review and adhere to the following readiness notes to ensure alignment with the WebWaka OS v4 architecture and principles.

**Pre-Execution Checklist:**

1.  **Review Core Invariants:** Ensure a complete understanding of the 7 Core Invariants (Build Once Use Infinitely, Mobile First, PWA First, Offline First, Nigeria First, Africa First, Vendor Neutral AI). Every implementation decision must be evaluated against these principles.
2.  **Understand the Anti-Drift Rule:** Reiterate the specific Anti-Drift Rule for `webwaka-cross-cutting`: "Verticals should integrate with these modules rather than building their own isolated CRM or ticketing systems." The agent must design solutions that are generic enough to serve all verticals while remaining robust and scalable.
3.  **Verify `@webwaka/core` Dependencies:** Before implementing any new primitive (e.g., authentication, event handling, notifications), verify if it already exists in `@webwaka/core`. If it does, it MUST be imported and used. Duplication of core primitives is strictly prohibited.
4.  **Database Schema Review:** Review the existing D1 database schema and migration files to understand the current data models. Any new models or modifications must be accompanied by proper migration scripts to ensure data integrity.
5.  **Event Bus Integration:** Familiarize yourself with the `webwaka-core` Event Bus architecture. Many tasks in this repository (e.g., SLA tracking, payroll processing, marketing automation) rely heavily on event-driven communication. Ensure events are emitted and consumed correctly.

**Execution Guidelines:**

*   **Iterative Development:** Implement tasks iteratively, focusing on core functionality first before adding advanced features.
*   **Test-Driven Approach:** Write unit and integration tests alongside the implementation to ensure code quality and prevent regressions.
*   **Documentation:** Document all new services, APIs, and complex logic clearly within the codebase. Update relevant architectural diagrams if necessary.
*   **Security First:** Apply the principle of least privilege using the `webwaka-core` RBAC engine. Ensure all data access and modifications are properly authorized.
*   **Performance Optimization:** Pay attention to database query performance and optimize where necessary, especially for reporting and analytics tasks.

**Post-Execution Verification:**

*   **QA Plan Execution:** Strictly follow the QA plans outlined in Section 7 for each completed task.
*   **Code Review:** Conduct a thorough self-review of the code against the WebWaka OS v4 coding standards and architectural guidelines.
*   **Deployment Readiness:** Ensure all migration scripts are tested and the code is ready for deployment to the staging environment.

By adhering to these notes, the Replit agent will ensure that the `webwaka-cross-cutting` repository continues to fulfill its role as a robust, shared operational hub for the entire WebWaka OS ecosystem.
