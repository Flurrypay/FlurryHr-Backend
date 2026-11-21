# Engineering progress — 20 November 2026

This is a verified implementation checkpoint. The complete production directive is unfinished; FlurryHR is not yet ready to be declared production complete. The requirement inventory contains 645 specification rows and 212 accompanying directive rows, with implementation status and evidence recorded individually in [PRODUCTION_COMPLETION_CHECKLIST.md](PRODUCTION_COMPLETION_CHECKLIST.md).

## Completed in this phase

- Attendance summary, dashboard and CSV now share database aggregation and classification. Late arrivals after shift end are included. Recorded sessions retain their schedule and work-date snapshot. UTC serialization, non-UTC PostgreSQL grace/expiry comparisons and live overnight dates were corrected.
- Lists gained bounded server pagination and frontend controls across the main modules. Invitations are grouped before pagination, with a separate paginated sending history. Tests exercise 1,001 invitations and a directory of 10,001 employees. Some nested collections, lookup lists and full filter contracts remain unfinished.
- Account security supports password changes, viewing/revoking active sessions and signing out all sessions. Password changes invalidate old reset links. Staff cannot revoke another identity's sessions.
- Platform access requires TOTP enrollment and recent MFA proof. Secrets are encrypted, recovery codes are hashed and single-use, replay and concurrent reuse are rejected, and reset/recovery actions are audited. Company owners, including legacy owner roles, remain protected from another administrator's offboarding or demotion.
- Mail workers reject obsolete invitation/token jobs and correctly schedule retries and leases under a non-UTC database timezone. Tests use files only. Provider delivery webhooks and external exactly-once sending are not implemented.
- Separate backend/frontend CI definitions, a guarded local backup command, migration fixtures and a synthetic restore drill were added. Documentation is tracked in backend/docs; the workspace docs path points there.

## Database and data preservation

Three additive migrations introduce attendance work-date/schedule snapshots and their protection trigger, invitation/mail pagination indexes, and platform MFA enrollment/recovery/session fields. All eight project migrations passed fresh and legacy fixture checks. Historical snapshot backfill is labelled inferred: it cannot reconstruct schedules that were never stored.

Local backups were taken before applying migrations to the working development database. Existing credentials, memberships and recorded attendance were checked afterward. No production database, real mail, payment, commit, push or deployment was performed. Existing platform users must enroll an authenticator on their next privileged login; no real account was enrolled or reset automatically.

## Performance evidence

Sequential local component/query benchmark: Node 24.21.0, PostgreSQL 16, Apple M1 Pro/16 GB. Baseline reproduces loading/filtering the directory; optimized implementation returns a bounded page. Baseline uses five samples, optimized twenty, with warmups. Errors: zero.

| Employees | Baseline p95 | Optimized p95 |
| --------- | ------------ | ------------- |
| 10        | 1.73 ms      | 1.30 ms       |
| 100       | 4.34 ms      | 1.35 ms       |
| 500       | 24.62 ms     | 3.45 ms       |
| 1,000     | 55.09 ms     | 5.30 ms       |
| 5,000     | 490.81 ms    | 24.03 ms      |
| 10,000    | 1,789.93 ms  | 51.45 ms      |

Raw results are in [attendance-summary.json](benchmarks/attendance-summary.json). This does not establish concurrent HTTP throughput, production latency or server resource budgets. The initially slower aggregation attempt is retained separately as evidence; the final grouped aggregation replaces it.

## Verification

25 unit tests, 158 HTTP response checks and 41 real SQL attendance/pagination assertions passed. Expanded Chrome company/staff/platform and mobile workflows passed. Public homepage navigation, reduced motion and four responsive widths also passed. Mail queue regression, all-eight migration preservation and synthetic backup/restore checks passed. Both applications passed lint, TypeScript, build and formatting checks. See [TEST_COVERAGE.md](TEST_COVERAGE.md) for boundaries. Remote GitHub CI has not run.

## Remaining work

Company setup and staff workflows exist and were exercised, but their full requested feature sets are incomplete. Next priorities are effective-dated schedule assignments and historical absences; editable/archive-safe company settings and ownership transfer; complete staff profile/email change; platform administrator invitation/roles/lifecycle; leave policies; payroll runs, reconciliation and payslips; recruitment/onboarding/offboarding expansion; report snapshots; training; storage scanning and production operations.

Production monitoring, encrypted/offsite scheduled backups with retention and alerts, concurrent load tests, storage/provider integrations and remote CI/deployment evidence remain outstanding. Emergency operator recovery requires a named operator and approved recovery policy. These are recorded separately from unfinished code in the checklist. Existing local backup and restore evidence does not establish production disaster recovery.

## Resume checkpoint

Continue with the next incomplete priority in the checklist: LIST-002 (remaining nested/lookup pagination and filtering), then effective-dated schedule assignments for historical absence rules, followed by company configuration editing and ownership transfer. Keep the full remaining specification inventory open; do not treat this checkpoint as acceptance of the full directive.
