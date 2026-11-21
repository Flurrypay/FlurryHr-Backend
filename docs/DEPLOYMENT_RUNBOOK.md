# Deployment runbook — incomplete operational setup

No production deployment is authorized. Build each application independently. Back up the database and private document volume before migration; confirm a tested restore and retention policy. Generate the Prisma client, deploy reviewed additive migrations, run unit/integration/browser/tenant-isolation checks and verify /api/health before routing traffic. Configure HTTPS WEB_ORIGIN, stable MAIL_ENCRYPTION_KEY, private Zoho credentials, least-privilege database account and durable private storage.

Rollback: stop writes and retain the failing release logs without secrets; roll back application binaries only if schema compatibility is established. Restore data only from a validated backup under an explicit incident procedure. Do not run destructive down migrations or overwrite working records as an automatic rollback.

Still required: CI, staging promotion, production health/alert wiring, automated database/file backup jobs, restore drill evidence and explicit deployment authorization.

## Current local migration and backup evidence

Eight migrations are deployed to the known development database on localhost:55433, after private custom-format pg_dump backups. `npm run db:backup` refuses production or unknown database targets and writes mode-0600 archives under backend/.local/backups. Archive validation alone is not a restore drill. A separate restore test used synthetic legacy migration fixtures, restored them into an empty isolated database and matched identity, session, organization, membership, employee, attendance and payroll signatures plus all eight migration records.

Run `npm run test:backup-restore` only with RESTORE_TEST_SOURCE_URL pointing to a local flurryhr_migration_test* fixture database and RESTORE_TEST_TARGET_URL pointing to an empty local flurryhr_restore_test* database. It does not restore the working database. Production backup scheduling, encryption/offsite storage, retention and failure alerts are still unconfigured.

## Platform login after MFA migration

Platform users sign in with existing credentials, then must enroll an authenticator at /platform-security before platform APIs are authorized. Save the one-time recovery codes offline. No real account was enrolled or reset by automated tests. Existing company credentials and memberships remain unchanged. Preserve MAIL_ENCRYPTION_KEY for both pending mail and encrypted MFA secrets. See MFA_RECOVERY.md.

## CI

backend/.github/workflows/verify.yml defines independent installs, lint/type/build/unit checks, additive migrations, attendance/pagination regression, legacy migration preservation, synthetic restore and sequential API/Chrome suites using PostgreSQL 16 and file-only email. Authentication rate limits are reset between independent suites by restarting the isolated API. This workflow has not yet run on the remote CI service; local execution evidence does not certify remote CI.

The frontend repository also has an independent lint/type/build/format workflow. Connected backend CI defaults to Flurrypay/FlurryHr-Frontend at main; configure FRONTEND_REF to the compatible frontend branch when coordinating API contract changes. Configure FRONTEND_READ_TOKEN with read access if the frontend is private and cannot be fetched with the backend workflow token. This connected checkout has not been verified remotely and must not be treated as a passing deployment gate yet.

## Pagination signing

Continuation tokens are authenticated, not authorization credentials. All replicas need the same stable signing material: PAGINATION_SIGNING_KEY (at least 32 bytes) if explicitly configured, otherwise a domain-separated key derived from MAIL_ENCRYPTION_KEY. Neither key is exposed in tokens. Development without both uses an ephemeral key and must restart list traversal after an API restart. Key rotation invalidates old cursors; it does not bypass normal session or tenant permissions. Redact cursor/search query values in production access logs because sort positions can contain employee names.
