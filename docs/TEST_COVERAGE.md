# Test coverage and evidence

Verified locally on 20 November 2026 against isolated PostgreSQL fixtures and file-only email transport. No real external messages or payments were sent.

| Check                  | Result                          | Scope                                                                                                                                                                                                                 |
| ---------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend unit tests     | 25 passed                       | Pagination, obsolete mail, domain rules and RFC 6238 TOTP vectors                                                                                                                                                     |
| SaaS HTTP suite        | 158 response checks passed      | Tenant isolation, staff/company workflows, account sessions, MFA/recovery/replay/concurrency and legacy owner protections                                                                                             |
| SaaS Chrome suite      | Passed                          | Registration, setup, custom dropdowns, invitation acceptance, attendance, leave, tasks, documents, assets, performance, CSV, two companies, platform MFA, suspension, offboarding, mobile and password/sign-out flows |
| Database regression    | See engineering progress report | Real SQL attendance classification, immutable snapshots, timezone serialization, large directory and invitation pagination                                                                                            |
| Mail queue regression  | Passed                          | UTC scheduling/leases, delayed retry, legacy queued messages, obsolete invitations and file transport failure                                                                                                         |
| Migration fixture      | Passed, eight migrations        | Fresh migration, legacy preservation, snapshot provenance and repeated deployment                                                                                                                                     |
| Backup/restore fixture | Passed                          | Custom dump restored to a separate empty synthetic database; row signatures and migration history compared                                                                                                            |
| Local working database | Passed                          | Additive migrations, existing company/platform credentials and recorded attendance preserved                                                                                                                          |
| Static checks          | Passed                          | Both apps: lint, TypeScript, production build and formatting                                                                                                                                                          |

The expanded browser suite was rerun after correcting two stale UI assertions. Added database checks exposed and fixed non-UTC grace/expiry and JSON timestamp defects. The sequential attendance benchmark is recorded in [benchmarks/attendance-summary.json](benchmarks/attendance-summary.json); it is not a concurrent HTTP capacity test.

CI workflows exist separately in each Git repository. They have not been pushed or run remotely. Backend connected-browser CI needs access to the matching frontend revision, potentially through `FRONTEND_READ_TOKEN` for a private repository.

Passing these suites verifies the exercised workflows, not every requirement in the original directive. Remaining functional and operational gaps are listed in [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md) and the completion checklist.

## 21 November continuation

Current unit suite: 30 passed. Expanded isolated PostgreSQL regression: 149 counted assertions, including 125 candidate/task/asset/document records, seven-page histories, 1,001 invitations, 126 sending-history records, 10,001 employees, 125 active sessions plus an expired fixture, forty future-dated organisations, tenant/role checks, filter boundaries, and cursor continuation after insertion/deletion of a page boundary. The connected HTTP suite previously passed 165 checks during this continuation; its final rerun is recorded in IMPLEMENTATION_HANDOFF.md. Chrome adds remote lookup search, native selected-value persistence, Escape behavior, employee Next/Previous navigation and bounded startup, task filters, candidate pages and large task/asset histories. These checks do not verify unfinished leave policies, payroll runs or other advanced modules.
