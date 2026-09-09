# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Multi-tenant SaaS for restaurant management (reservations, floor plan, tables, customers, employees). Two independent apps in one repo:

- `restaurante_manage/` — Spring Boot 3.3 / Java 21 REST API (Maven), MySQL in prod, H2 in the `dev` profile.
- `restaurante-frontend/` — React 19 + Vite SPA (pnpm), Bootstrap 5, react-router v7.

The codebase, comments, commit messages, and user-facing text are in **Spanish**. Commits follow Conventional Commits (`feat(auth): ...`, `fix(mesa): ...`).

## Commands

### Backend (`restaurante_manage/`)

```
mvn spring-boot:run -Dspring-boot.run.profiles=dev   # run with H2 in-memory + demo data
mvn spring-boot:run                                   # run against MySQL (localhost:3307)
mvn test                                              # run tests
mvn test -Dtest=SomeClassTest                         # run a single test class
docker-compose up                                     # API + MySQL 8 (MySQL exposed on host port 3307)
```

API base path is `/api/v1` on port 8080. Swagger UI at `/swagger-ui.html`, H2 console (dev profile) at `/h2-console`.

The `dev` profile seeds demo data via `DemoDataInitializer` (password `admin123` for all): `super.admin` (SUPER_ADMIN), `juan.admin` (ADMIN), plus manager/employee users.

**⚠️ `dev` profile is volatile and NOT the user's real data.** It uses an in-memory H2 database (`ddl-auto: create-drop`) reseeded from scratch on every start, including demo reservations dated `CURRENT_DATE`/`CURRENT_DATE+N` from `data.sql` — these show up looking like reservations nobody made. Never start the backend with `-Dspring-boot.run.profiles=dev` to "just check something" against what the user believes is their real data — that wipes/hides it for the session. The user's real data lives in MySQL (`docker-compose up`, or `mvn spring-boot:run` with no profile, both against `localhost:3307`). Default to the no-profile command unless demo/throwaway data is explicitly what's needed.

### Frontend (`restaurante-frontend/`)

```
pnpm install
pnpm dev        # Vite dev server on http://localhost:5173
pnpm build
pnpm lint       # eslint
pnpm test       # vitest run (~150 tests)
pnpm test:watch # vitest, watch mode
```

The API URL is **configurable, not hardcoded**: `src/api/axios.js` and `src/api/publicAxios.js` read `import.meta.env.VITE_API_URL` and fall back to `http://localhost:8080/api/v1`. In production, **Vercel must define `VITE_API_URL`** or the deployed frontend calls localhost. The value is normalised, so it works with or without the trailing `/api/v1`.

Backend CORS is likewise configurable via `CORS_ALLOWED_ORIGINS` (comma-separated), defaulting to `http://localhost:5173`. `SecurityConfig#corsConfigurationSource()` is the single source of truth for allowed origins — in production it must list the real frontend domain.

## Architecture

### Backend: feature-package layout

Each domain feature (`auth`, `restaurant`, `diningtable`, `floorplan`, `reservation`, `serviceperiod`, `customer`, `employee`, `user`, `availability`, `notification`, `publicapi`, `tenant`, `role`, `subscription`) is a self-contained package with `controller/`, `service/`, `repository/`, `entity/`, `dto/` (request, response, and a static mapper class). Cross-cutting code lives in `common/` (ApiResponse/PagedResponse wrappers, GlobalExceptionHandler, JPA auditing, Constants) and `security/`. All URL paths and role names are constants in `common/util/Constants.java` — reference them, don't inline strings.

### Multi-tenancy and authorization (the core invariant)

Data is partitioned by `Tenant` → `Restaurant`. **`common/security/CurrentUserService` is the single authority for tenant/restaurant scoping** — every service that reads or writes restaurant-scoped data must filter through it:

- `SUPER_ADMIN` — no tenant, sees everything (SaaS owner).
- `ADMIN` — sees all restaurants of their tenant.
- `MANAGER` — restaurants explicitly assigned, or all tenant restaurants if no assignments.
- `EMPLOYEE` — only explicitly assigned restaurants (none if no assignments).

Use `getVisibleRestaurantIds()` (empty list = "no ID filter", `[-1]` = "match nothing") and `validateRestaurantAccess(id)` when adding new queries/endpoints. The JWT (`JwtTokenProvider` + `JwtAuthenticationFilter`) carries the principal; sessions are stateless.

Public (no-JWT) surface, defined in `SecurityConfig`: `/auth/**`, GET restaurants, POST availability, and `/api/v1/public/**` (public reservation flow used by the QR-code landing page).

### Entities

All entities extend `common/audit/BaseEntity` (createdAt/updatedAt auditing + **soft delete** via `deleted`/`deletedAt`). Deletion is logical: repositories/queries must filter `deletedFalse` — see existing repository methods like `findByStatusAndDeletedFalse`.

**Schema is managed by Flyway** (`restaurante_manage/src/main/resources/db/migration/`, `V1`…`V9`), not by Hibernate. `application.yml` sets `ddl-auto: validate` — Hibernate only checks entities match the schema Flyway already applied; it never creates or alters tables. Only the `dev` profile (`application-dev.yml`) uses H2 with `ddl-auto: create-drop` and Flyway disabled. Consequence: every new table needs **both** a Flyway migration (MySQL/prod, and what `mvn test` runs against outside `dev`) **and** a matching JPA entity — a mismatch between them makes the app fail to start in production, because `validate` rejects it at boot. Write the migration and the entity together, and verify startup against local MySQL (`localhost:3307`) before deploying.

### Plans and entitlements

The app is a paid SaaS with two plans per tenant, NORMAL and PRO, billed with Stripe. **`subscription/service/EntitlementService` is the single authority for what a tenant's plan allows** — the same role `CurrentUserService` plays for tenant isolation. Every feature/limit check goes through it (`hasFeature`, `require(Feature)`, `requireCapacity(Resource)`), never a hand-rolled `if (plan == PRO)`.

- The plan → features/limits catalog lives in code, `subscription/catalog/PlanCatalog.java`, not in a database table. With `ddl-auto: validate` and no admin UI for it, a mis-seeded catalog table would silently strip every tenant's features; the code version is covered by a test that pins the plan × feature matrix, so an accidental change breaks the build instead of production.
- The plan check happens in the **service layer**, next to the existing tenant check (`currentUserService.validateRestaurantAccess(...)` then `entitlements.require(...)`/`requireCapacity(...)`) — never only in the controller, and never only in the frontend. The frontend's `hasFeature`/candados are for UX only; the enforcement that matters is server-side.
- Payment state (`Subscription.status`, `planCode`, etc.) is changed **only** by `StripeWebhookService`, driven by signature-verified Stripe webhooks. Nothing else writes to it — not an endpoint, not an admin action.
- There are **three places that create a `User` account** — `POST /users`, `POST /auth/register`, and `POST /employees` (when it creates a linked user) — and all three must call `entitlementService.requireCapacity(Resource.USER_ACCOUNT)` before creating one. Missing it on one of them has already let a tenant exceed their account limit; when adding a fourth way to create a user, check this first.

See `docs/billing-stripe-setup.md` for how to configure Stripe (products, prices, webhooks, environment variables) in local dev and in production.

### Frontend structure

- `src/api/axios.js` — authenticated client; attaches JWT from localStorage, and on 401 clears the session and dispatches an `auth:unauthorized` CustomEvent that `AuthContext` listens to (deliberately no `window.location` redirect — it caused reload loops). `publicAxios.js` is the token-less client for public pages.
- `src/config/permissions.js` — frontend role→permission map (`VIEW_*` / `MANAGE_*`). Routes are gated in `App.jsx` by `ProtectedRoute` + `PermissionRoute`; the sidebar/pages check the same permissions. Keep this in sync with backend role rules when changing authorization.
- `src/services/*.js` — one thin API module per backend feature; pages in `src/pages/` consume them directly (no state library; contexts for auth, theme, notifications).
- Public reservation page is served at `/r/:restaurantId` (QR target) and `/public/reservar/:restaurantId`.

## MCP TOOLING

Three MCP servers are configured for this project. **Status as of the last audit (2026-09-09):**

| Server | Status | Verified by |
|---|---|---|
| Context7 | ✅ Operational | Resolved `/spring-projects/spring-boot/v3.3.11` and retrieved real, version-scoped docs |
| Playwright | ✅ Operational | Drove a real Chromium session against the local Vite dev server: navigation, accessibility snapshot, form input, submit, console errors, network inspection |
| Railway | ✅ Operational — **use `railway-local`** | The remote server (`railway`, `https://mcp.railway.com`) still reports `Needs authentication` and its tools are not exposed. The working entry is `railway-local`, a stdio server (`cmd /c railway mcp local`) that runs in-process and reuses the Railway CLI's existing session, so it needs no OAuth. Verified by `claude mcp list` → `√ Connected` |

Do not assume a server works because it is listed in the config. If a tool call fails, say so and report the failure — never silently fall back and present the result as if the tool had run.

### Context7 — external library documentation

Use Context7 whenever the work depends on an **external** library or framework: Spring Boot, Spring Security, Hibernate/JPA, Flyway, Stripe (`stripe-java`), React, Vite, react-router, Bootstrap, Maven plugins, vitest, Testing Library.

**Rule:** before assuming that an API, configuration key, method signature or pattern of an external dependency is still valid, consult Context7 whenever there is a reasonable chance it has changed. Prefer current documentation over internal knowledge, which may be stale. This applies even to frameworks that feel familiar.

Version matters here. The project pins **Spring Boot 3.3.5**, **Java 21**, **React 19**, **Vite 8**, **stripe-java 33.4.1** — when Context7 offers a version-specific library ID, use the one closest to what `pom.xml` / `package.json` actually declare, not the latest.

Do **not** reach for Context7 for logic that belongs to this project and depends on no external API: multi-tenant scoping rules, the plan catalog, reservation business rules, or refactoring internal code.

Known real-world payoff: `stripe-java` moved `current_period_start` / `current_period_end` off `Subscription` and onto `SubscriptionItem`, and `Invoice.getSubscription()` no longer exists (the id now lives at `Invoice.getParent().getSubscriptionDetails().getSubscription()`). Both were caught by checking the actual library instead of trusting memory.

### Playwright — verifying visible behaviour

Use Playwright to verify changes that affect **visible or interactive** behaviour: login, navigation, forms, reservations, customers, employees, tables, the floor plan, the dashboard, billing, role-based permissions, visible error states, and complete frontend↔backend flows.

After implementing a significant UI or user-flow change, consider an end-to-end run. When testing:

1. Check the **visible behaviour**, not just that the page loads.
2. Check **console errors** when relevant (`browser_console_messages`).
3. Check **failed network requests** when relevant (`browser_network_requests`).
4. Do not settle for "the page rendered" — exercise the flow that actually changed.
5. Prefer the accessibility snapshot (`browser_snapshot`) over screenshots for driving interactions; screenshots are for showing the user what something looks like.

**Never run destructive flows against production.** Point the browser at `http://localhost:5173`. The local stack needs, in order: Docker (MySQL on 3307) → backend (`mvn spring-boot:run`, no profile) → frontend (`pnpm dev`). The login page renders without the backend, but any authenticated flow needs all three.

Use obviously fake credentials and test data in browser sessions, and never type a real password into a page under automation.

### Railway — read-only diagnostics of the deployed backend

Railway is for **diagnosing the deployed backend**: service status, deployments, logs, HTTP errors, production incidents, and confirming a deployment is actually serving.

**SAFETY RULE — Railway is READ-ONLY by default.**

Claude may query information freely, without asking. Claude **must obtain explicit authorisation before**:

- modifying environment variables
- deploying or redeploying
- deleting deployments or services
- changing service configuration, domains or networking
- modifying databases
- any other potentially destructive action

**Never read a request to "investigate", "check", "review" or "diagnose" as permission to modify production.** When a diagnosis points to a change, describe the change and ask.

**Which server to use.** Two Railway entries exist in the user config. Use **`railway-local`** — it works. The remote `railway` entry is unauthenticated and its tools are not exposed; ignore it (or remove it with `claude mcp remove railway -s user`).

**CLI fallback.** The Railway CLI is installed and logged in, and works without linking the repo as long as ids are passed explicitly:

```
railway list --json                                   # projects, services, environments + their ids
railway deployment list -p <projectId> -s <service> -e production
railway logs -p <projectId> -s <service> -e production --lines 40 -d   # -b build, --http http
railway metrics -p <projectId> -s <service>
```

Always pass `--lines` to `railway logs`: without it the command **streams and never exits**.

This repository is **not linked** to a Railway project — `railway link` writes local configuration, so treat it as a change and ask first. Never run `railway down`, `railway deployment up`, `railway deployment redeploy`, `railway delete` or any `variables` write without explicit authorisation.

**Project map** (from the last audit): the Restaurant Manager lives in project **`considerate-achievement`** (`6212c15a-6778-427c-967a-5b5483c1952e`), environment `production`, with two services — **`SaaS-Restaurantes`** (the Spring Boot API) and **`MySQL`**. The other project, `harmonious-radiance`, has no services and appears to be an empty leftover.

## Working method

When it fits the task, follow this sequence:

1. Understand the problem before touching anything.
2. **Inspect the existing code before modifying it** — this codebase has invariants (tenant scoping, entitlements, soft delete, Flyway) that are easy to break from the outside.
3. Consult Context7 if external APIs or libraries are involved and there is any doubt about current usage.
4. Implement the **minimum necessary change**.
5. Run the existing tests (`mvn test`, `pnpm test`).
6. Run build and lint where applicable (`pnpm lint`, `pnpm build`).
7. Use Playwright if the change affects UI or user flows.
8. Use Railway to investigate problems with the deployed backend when relevant.
9. Review the final diff.
10. Report: what changed, what tests were run, **what actually passed**, what could not be verified, and any risk or remaining work.

Do not use an MCP server for its own sake. Each tool earns its place by producing real information or real validation.

Report outcomes faithfully. If a test fails, show the output. If a step was skipped or could not be verified, say so plainly rather than implying it passed.

## Security rules

- **Never display secrets, tokens or passwords** — not in output, not in logs, not in commit messages.
- **Never write secrets into CLAUDE.md** or any other tracked file. Configuration goes in as `${VARIABLE}` references only.
- **Never commit `.env` or credentials.** `restaurante_manage/.env` is gitignored and must stay that way.
- **Do not modify production without authorisation** — this covers Railway, Vercel, Stripe and the production database.
- **Do not delete data.** Deletion in this codebase is logical (`deleted` / `deletedAt`); physical deletion is not an ordinary operation.
- **Do not run destructive migrations without authorisation.** Flyway migrations are additive; a migration containing `DROP`, `DELETE` or an `UPDATE` over existing columns must be reviewed by the user first.
- **Do not push or merge automatically.** Commit locally only when asked; push, PRs and merges are always explicit user requests.
- **Never treat an ambiguous request as authorisation for a destructive action.** When in doubt, ask.
- **Prefer reversible operations.** Where a change cannot be undone, take a backup first and say where it is.
