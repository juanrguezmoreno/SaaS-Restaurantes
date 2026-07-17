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
```

There are no frontend tests. The API URL is hardcoded to `http://localhost:8080/api/v1` in `src/api/axios.js` and `src/api/publicAxios.js`. Backend CORS only allows origin `http://localhost:5173`.

## Architecture

### Backend: feature-package layout

Each domain feature (`auth`, `restaurant`, `diningtable`, `reservation`, `customer`, `employee`, `user`, `availability`, `dashboard`, `publicapi`, `tenant`, `role`) is a self-contained package with `controller/`, `service/`, `repository/`, `entity/`, `dto/` (request, response, and a static mapper class). Cross-cutting code lives in `common/` (ApiResponse/PagedResponse wrappers, GlobalExceptionHandler, JPA auditing, Constants) and `security/`. All URL paths and role names are constants in `common/util/Constants.java` — reference them, don't inline strings.

### Multi-tenancy and authorization (the core invariant)

Data is partitioned by `Tenant` → `Restaurant`. **`common/security/CurrentUserService` is the single authority for tenant/restaurant scoping** — every service that reads or writes restaurant-scoped data must filter through it:

- `SUPER_ADMIN` — no tenant, sees everything (SaaS owner).
- `ADMIN` — sees all restaurants of their tenant.
- `MANAGER` — restaurants explicitly assigned, or all tenant restaurants if no assignments.
- `EMPLOYEE` — only explicitly assigned restaurants (none if no assignments).

Use `getVisibleRestaurantIds()` (empty list = "no ID filter", `[-1]` = "match nothing") and `validateRestaurantAccess(id)` when adding new queries/endpoints. The JWT (`JwtTokenProvider` + `JwtAuthenticationFilter`) carries the principal; sessions are stateless.

Public (no-JWT) surface, defined in `SecurityConfig`: `/auth/**`, GET restaurants, POST availability, and `/api/v1/public/**` (public reservation flow used by the QR-code landing page).

### Entities

All entities extend `common/audit/BaseEntity` (createdAt/updatedAt auditing + **soft delete** via `deleted`/`deletedAt`). Deletion is logical: repositories/queries must filter `deletedFalse` — see existing repository methods like `findByStatusAndDeletedFalse`. Hibernate `ddl-auto` is `update` (prod) / `create-drop` (dev); there are no migration scripts.

### Frontend structure

- `src/api/axios.js` — authenticated client; attaches JWT from localStorage, and on 401 clears the session and dispatches an `auth:unauthorized` CustomEvent that `AuthContext` listens to (deliberately no `window.location` redirect — it caused reload loops). `publicAxios.js` is the token-less client for public pages.
- `src/config/permissions.js` — frontend role→permission map (`VIEW_*` / `MANAGE_*`). Routes are gated in `App.jsx` by `ProtectedRoute` + `PermissionRoute`; the sidebar/pages check the same permissions. Keep this in sync with backend role rules when changing authorization.
- `src/services/*.js` — one thin API module per backend feature; pages in `src/pages/` consume them directly (no state library; contexts for auth, theme, notifications).
- Public reservation page is served at `/r/:restaurantId` (QR target) and `/public/reservar/:restaurantId`.
