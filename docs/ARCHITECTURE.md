# Actual architecture

Independent frontend React/Vite and backend NestJS/Prisma/PostgreSQL projects. Identity is global; organization membership determines tenant role and employee linkage. Request-local tenant scope is enforced by a Prisma query extension; system-client operations require explicit predicates. PostgreSQL composite constraints protect cross-tenant references. Authentication uses hashed opaque cookie sessions. Zoho HTTP API mail jobs use encrypted bodies, leases and retry backoff; file mail is test-only. Documents currently use a private local filesystem adapter.

The backend and frontend are independent Git repositories with their own dependencies and runtime configuration. New changes and their verification are tracked in PRODUCTION_COMPLETION_CHECKLIST.md. Production storage, subscription, advanced payroll and operational automation are not implemented merely by this document.

## New boundaries

Attendance calculation moved into one PostgreSQL aggregation service. Work dates and immutable schedule snapshots are populated by a trigger. Pagination uses a shared bounded contract with unique ordering keys; invitation grouping occurs before paging and sending history has its own page endpoint. CSV writes honor response backpressure.

Account security reuses the existing identity cookie, password hash and session table. Platform APIs require an enrolled authenticator and a recent session MFA proof. Secrets are encrypted; recovery codes are hashed and consumed under a user-row lock. See MFA_RECOVERY.md. No separate credential system was introduced.

## Repository layout

Backend and frontend are separate Git repositories. Engineering documentation is tracked in backend/docs; workspace docs is a symlink to that directory so the requested docs paths remain available without duplicate copies. Each repository owns a .github/workflows/verify.yml. Backend CI checks out Flurrypay/FlurryHr-Frontend into a sibling directory for connected tests; FRONTEND_REPOSITORY and FRONTEND_REF can select another compatible source/ref. A private frontend requires a read token configured as FRONTEND_READ_TOKEN when the backend workflow token lacks access. Neither repository was committed, pushed or deployed by this work.

## 21 November pagination continuation

Jobs return candidate counts and separate scoped candidate pages. Task/asset history dialogs load independent pages. Shared list filters intersect existing authorization predicates. HMAC-authenticated continuation tokens bind permitted ordering/filter scope and tenant context; raw SQL lists supply explicit organization scope. Tokens are pagination positions, not authorization credentials. Mutable sort fields require refresh; immutable snapshot reporting remains unfinished.

Shared entity forms use server-searchable custom lookup menus with bounded option pages and selected-value hydration. Workspace startup keeps only initial employee/job options; asset and performance labels are returned with their scoped rows. Configuration collections are still fully traversed. Prisma Asset/PerformanceReview employee relations map existing composite foreign keys; this continuation introduces no new database DDL.
