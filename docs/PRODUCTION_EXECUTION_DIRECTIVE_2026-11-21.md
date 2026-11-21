# FLURRYHR — EXECUTE THE COMPLETE PRODUCTION CHECKLIST

You are continuing implementation of the existing FlurryHR codebase.

This is a full engineering execution assignment, not a planning or auditing-only assignment.

## AUTHORITATIVE FILES

Read these files in full before proceeding:

1. `backend/docs/PRODUCTION_COMPLETION_CHECKLIST.md`
2. `backend/docs/PRODUCTION_DIRECTIVE.md`
3. `backend/docs/ARCHITECTURE.md`
4. `backend/docs/KNOWN_LIMITATIONS.md`
5. `backend/docs/TEST_COVERAGE.md`
6. `backend/docs/ATTENDANCE_RULES.md`

Inspect the actual repository to verify the accuracy of the documented implementation status.

## CRITICAL INSTRUCTION

The production completion checklist contains hundreds of individually tracked requirements.

EVERY applicable requirement must be accounted for.

Do not replace the checklist with a shorter summary.

Do not skip requirements because their parent module appears functional.

Do not mark requirements VERIFIED merely because a related feature has passing tests.

Do not overwrite existing VERIFIED evidence without investigating it.

Do not mark unimplemented work BLOCKED unless a genuine external dependency prevents it.

Do not rebuild the application or replace functioning architecture unnecessarily.

## EXECUTION PROCESS

1. Parse the entire checklist, including ATT, LIST, OPS, PERF, AUTH, SEC, SPEC, PROSE and EXT entries.
2. Preserve the original requirement IDs.
3. Identify duplicate descriptions and parent-child relationships without deleting the original entries.
4. Reconcile each status against actual source code and tests.
5. Create a dependency-aware implementation queue.
6. Start implementing the highest-priority actionable incomplete requirement.
7. Finish backend, frontend, database, permissions, validation, error handling and tests.
8. Verify the complete workflow.
9. Update the corresponding checklist entries with real evidence.
10. Continue to the next actionable requirement.

Do not stop after one feature, one phase or one successful test run.

## IMPLEMENTATION PRIORITIES

Complete the remaining work in this order, adjusting only for genuine technical dependencies:

1. Finish pagination, nested recruitment lists, dropdown lookups and search/filter consistency.
2. Complete effective-dated schedules, historical attendance and overnight shift edge cases.
3. Complete company configuration, editing, archiving, restoration and ownership transfer.
4. Complete employee self-service profiles and secure email changes.
5. Complete platform administrator invitations, role management, deactivation, support and subscription operations.
6. Complete leave policies, accrual, carry-over, prorating and approval rules.
7. Complete payroll runs, adjustments, approvals, reconciliation, evidence and payslips.
8. Complete recruitment interviews, CV management, onboarding templates and scheduled offboarding.
9. Complete performance review cycles, asset management, training and reporting.
10. Complete document storage, malware scanning, retention and versioning.
11. Complete email delivery tracking, bounce handling and reminder revalidation.
12. Complete monitoring, alerts, encrypted offsite backups, restoration testing and CI/CD.
13. Complete concurrent load testing, security regression testing and full end-to-end verification.

All other requirements in the checklist remain mandatory, even if they are not explicitly repeated above.

## REQUIRED VERIFICATION

For each requirement, verify:

- Correct API behaviour
- Correct frontend behaviour
- Database persistence
- Tenant isolation
- Role permissions
- Validation and failure handling
- Concurrency and idempotency where applicable
- Relevant automated tests
- Integration with dependent modules
- Historical data preservation

Use isolated environments and realistic fixtures.

Never fabricate benchmark results or claim external services were verified without access.

## EXTERNAL BLOCKERS

Preserve the existing EXT-001 through EXT-006 dependencies.

Implement all independent code and test coverage that can be completed without external access.

Request authorisation only when genuinely necessary for live payroll transfers, production deployment, security recovery policy, real email testing or infrastructure configuration.

Do not perform unauthorised production operations.

## PERSISTENT PROGRESS

Maintain:

`backend/docs/PRODUCTION_COMPLETION_CHECKLIST.md`

`backend/docs/IMPLEMENTATION_HANDOFF.md`

After every completed requirement, record:

- Requirement ID
- Implementation changes
- Files modified
- Tests added
- Test results
- Remaining dependencies
- Updated status

Before ending any session, save the exact next unfinished requirement and the current repository state.

When resumed, read the handoff and continue without repeating completed work.

## FINAL ACCEPTANCE

Do not declare production readiness until all applicable requirements have verifiable evidence and no critical unresolved defects remain.

At completion, report:

- Total requirements by status
- All implemented and verified requirements
- Test results
- Remaining external blockers
- Security findings
- Performance measurements
- Deployment readiness
- Exact outstanding work, if any

Do not claim zero outstanding work unless the checklist and verification evidence support that conclusion.

## START NOW

Read the complete files.

Reconcile the tracker with the current code.

Immediately continue implementation from the first actionable incomplete requirement.

Do not stop at another audit or implementation plan.

Continue through the full checklist, preserving progress across execution sessions.
