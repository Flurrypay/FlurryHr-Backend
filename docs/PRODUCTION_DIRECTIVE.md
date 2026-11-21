# FLURRYHR — COMPLETE PRODUCTION READINESS, FEATURE COMPLETION & END-TO-END ENGINEERING DIRECTIVE

## ROLE

You are acting as the Principal Software Architect, Staff Full-Stack Engineer, Senior Database Engineer, Application Security Engineer, DevOps Engineer, QA Automation Lead and Senior Product Designer responsible for completing FlurryHR.

You are continuing development of the EXISTING FlurryHR codebase.

The system already contains a functioning MVP with company registration, organisation onboarding, employee invitations, staff workspaces, attendance, leave, recruitment, payroll, performance, documents, assets, notifications and platform administration.

However, multiple features remain incomplete, several correctness and performance defects have been identified, and production readiness has not been demonstrated.

**Your mission is to close every identified gap, discover additional gaps, implement the missing workflows, repair defects and prove that the platform operates correctly as a complete multi-tenant SaaS application.**

This is not a prototype assignment.

This is not a UI redesign.

This is not an invitation to rebuild the application.

This is a full engineering completion and verification assignment.

The final application must be secure, reliable, efficient, scalable, maintainable, visually consistent and usable by real companies and their employees.

---

# 1. NON-NEGOTIABLE INSTRUCTIONS

1. Continue from the existing repository.
2. Preserve the current architecture unless a specific defect requires improvement.
3. Preserve existing database records.
4. Preserve the established clean blue-and-white design system.
5. Do not replace functioning components unnecessarily.
6. Do not introduce duplicate authentication, payroll or attendance implementations.
7. Do not create decorative features without backend functionality.
8. Do not use hardcoded statistics or simulated production data.
9. Do not ignore failed tests.
10. Do not consider TypeScript compilation proof of functional correctness.
11. Do not silently truncate lists or reports.
12. Do not bypass tenant isolation.
13. Do not weaken authentication or permissions.
14. Do not claim successful email delivery without provider confirmation.
15. Do not introduce real payment transfers without an explicitly approved integration.
16. Do not deploy to production or alter production infrastructure without explicit authorisation.
17. Do not stop after completing the easiest tasks.
18. Do not claim the system is production-ready without evidence.

Every feature must work from the user interface through the backend, database, permissions, business logic and reporting layers.

---

# 2. ESTABLISH A COMPLETE REQUIREMENTS INVENTORY

Before implementation, inspect the repository and compare it against this entire specification.

Create a file:

`docs/PRODUCTION_COMPLETION_CHECKLIST.md`

Every requirement must have:

- Unique requirement ID
- Module
- Expected behaviour
- Existing implementation
- Identified gap
- Priority
- Dependencies
- Implementation status
- Relevant files
- Test coverage
- Verification evidence

Use these statuses:

- NOT_STARTED
- IN_PROGRESS
- IMPLEMENTED
- VERIFIED
- BLOCKED

Do not mark a requirement VERIFIED until its actual workflow has been tested.

A passing test that does not exercise the intended business behaviour is insufficient.

Do not omit requirements because they are difficult or time-consuming.

If a requirement depends on external credentials, infrastructure or a business-policy decision, mark it BLOCKED with the exact dependency and complete all independent implementation work.

Keep this checklist updated throughout development.

Also create:

`docs/ARCHITECTURE.md`

`docs/PERMISSIONS_MATRIX.md`

`docs/TEST_COVERAGE.md`

`docs/DEPLOYMENT_RUNBOOK.md`

`docs/KNOWN_LIMITATIONS.md`

These must reflect the actual implementation, not an idealised architecture.

---

# 3. IMMEDIATE PRIORITY — FIX EXISTING CORRECTNESS DEFECTS

## 3.1 Attendance false-absence defect

A known defect exists where an employee can have a completed attendance session while the daily summary still reports them as absent.

The current summary logic may exclude sessions beginning after the scheduled shift end.

Investigate and fix this at the business-logic level.

Requirements:

- A recorded session must not be silently ignored because it began late.
- Late attendance and absence must be distinguished correctly.
- Attendance status must follow a documented precedence model.
- Attendance summaries must consider approved leave, holidays, rest days and scheduled shifts.
- Multiple sessions must be handled correctly.
- Overnight shifts must be handled correctly.
- Incomplete sessions must be handled correctly.
- Attendance corrections must be reflected consistently.
- Dashboard and CSV reports must use the same calculation rules.
- Historical attendance must remain accurate after schedule changes.

Design a central attendance calculation service.

Do not duplicate attendance classification logic across endpoints.

Create tests covering:

1. On-time arrival
2. Late arrival
3. Arrival after scheduled shift end
4. Completed late session
5. No attendance session
6. Approved leave
7. Public holiday
8. Rest day
9. Overnight shift
10. Multiple sessions
11. Incomplete session
12. Corrected session
13. Missing clock-out
14. Schedule modification
15. Employee timezone differences

Document the exact attendance status precedence rules.

Do not silently convert worked time into approved payable time.

## 3.2 Pagination and silent truncation

Known issue: some lists stop at 100 records.

Investigate all list endpoints, including:

- Employees
- Invitations
- Departments
- Attendance
- Leave requests
- Recruitment
- Payroll
- Documents
- Assets
- Tasks
- Notifications
- Reports
- Audit logs
- Platform organisations

Implement reliable server-side pagination.

Requirements:

- Deterministic ordering
- Stable pagination
- Appropriate maximum page size
- Total counts where supported
- Search and filters
- Correct handling of deleted or archived records
- Proper loading states
- No silent truncation

Invitation grouping must not depend on fetching an arbitrary limited number of records.

Use appropriate database queries or complete paginated retrieval.

Test datasets exceeding:

- 100 records
- 500 records
- 1,000 records
- 10,000 records where appropriate

## 3.3 Attendance performance

The existing implementation reportedly fetches up to 10,000 employees and processes attendance summaries in application memory.

Investigate this architecture.

Replace unnecessary large in-memory processing with efficient database queries, aggregation or carefully justified precomputed summaries.

Requirements:

- Tenant-scoped queries
- Indexed date filters
- Efficient employee filtering
- Correct pagination
- Bounded memory usage
- No unnecessary N+1 queries
- Efficient dashboard trends
- Consistent attendance calculations

Benchmark before and after optimisation.

Do not optimise blindly.

Document measured improvements.

---

# 4. COMPLETE COMPANY ONBOARDING AND ADMINISTRATION

## 4.1 Company registration

Verify the full lifecycle:

Registration → Email Verification → Organisation Creation → Onboarding → Dashboard.

Ensure:

- Input validation
- Duplicate protection
- Secure verification tokens
- Idempotent organisation creation
- Correct owner membership
- Correct onboarding progress
- Safe resume after interruption
- Proper error handling
- Correct redirects

## 4.2 Company profile

Support:

- View company information
- Edit company details
- Upload or replace logo
- Configure timezone
- Configure working location
- Configure company contact information
- View organisation status

All changes must persist.

## 4.3 Department management

Complete:

- Create department
- Edit department
- Assign department head
- Change department head
- Archive department
- Restore archived department where supported
- View department employees
- Transfer employees between departments

Prevent destructive changes that leave employee records inconsistent.

Define behaviour when archiving a department with active employees.

## 4.4 Work schedules

Complete:

- Create schedule
- Edit schedule
- Archive schedule
- Assign schedule
- Reassign employees
- Configure workdays
- Configure start and end times
- Configure grace periods
- Configure break rules
- Support overnight shifts
- Support timezone-aware schedules

Historical attendance must retain the schedule rules applicable at the time.

## 4.5 Holidays

Complete:

- Create holiday
- Edit holiday
- Archive holiday
- Configure recurring holidays
- Configure company-specific holidays
- Support country-specific calendars where appropriate
- Apply holidays to attendance and leave calculations

Do not hardcode holidays without an authoritative configuration.

## 4.6 Leave types and policies

Complete:

- Create leave type
- Edit leave type
- Archive leave type
- Configure entitlement
- Configure accrual
- Configure carry-over
- Configure prorating
- Configure maximum balances
- Configure approval requirements
- Configure cancellation rules
- Configure probation restrictions
- Configure negative balance policy

Preserve historical records when policies change.

## 4.7 Company ownership transfer

Implement a secure ownership transfer workflow.

Requirements:

- Current owner authorisation
- Strong reauthentication
- Recipient eligibility validation
- Explicit recipient acceptance
- Atomic ownership transfer
- Prevention of ownerless organisations
- Audit history
- Notification of relevant parties

Never allow a company to lose its final authorised owner through accidental role changes.

---

# 5. COMPLETE EMPLOYEE ACCOUNT & SELF-SERVICE MANAGEMENT

## 5.1 Employee invitation lifecycle

Verify:

- Invitation creation
- Email delivery
- Resend
- Expiration
- Revocation
- Acceptance
- Existing-user acceptance
- New-user registration
- Duplicate prevention
- Employee record linking
- Correct organisation membership
- Correct role assignment
- Correct onboarding status

Ensure invitation acceptance is transactional and idempotent.

## 5.2 Employee profile management

Employees should be able to update permitted personal information.

Examples:

- Display name where policy permits
- Phone number
- Address
- Emergency contact
- Profile picture
- Notification preferences

Sensitive employment information must require HR approval or restricted permissions.

Maintain appropriate change history.

## 5.3 Account security

Implement:

- Change password
- Forgot password
- Reset password
- View active sessions
- Revoke other sessions
- Sign out all devices
- Account security notifications
- Secure email-change verification
- Reauthentication for sensitive actions

Reuse the existing authentication provider and session architecture.

Do not introduce competing credential systems.

## 5.4 Employee onboarding

Clearly separate:

Employee responsibilities:

- Complete personal profile
- Review company policies
- Upload required documents
- Acknowledge relevant policies
- Complete assigned onboarding tasks

HR responsibilities:

- Verify documents
- Assign department
- Assign manager
- Confirm employment information
- Assign work schedule
- Approve onboarding completion

Track:

- Pending
- In progress
- Awaiting HR
- Completed
- Blocked

Show progress on both employee and HR dashboards.

---

# 6. COMPLETE ROLES, PERMISSIONS & TENANT SECURITY

Build a comprehensive permission matrix.

Roles:

- Platform Super Admin
- Platform Administrator
- Company Owner
- Company HR Admin
- Department Head
- Manager
- Finance
- Employee

Support users with multiple organisation memberships.

Do not assume every user has only one role.

## Permission coverage

Document and test permissions for:

- Company settings
- Employee records
- Employee invitations
- Attendance
- Attendance corrections
- Leave requests
- Leave approvals
- Payroll
- Recruitment
- Performance
- Documents
- Assets
- Tasks
- Announcements
- Reports
- Audit logs
- Company suspension
- Platform administration

For every sensitive action, test:

1. Authorised role
2. Unauthorised role
3. Different organisation
4. Inactive membership
5. Revoked membership
6. Suspended organisation
7. Expired session
8. Changed role
9. Resource ownership mismatch

Enforce permissions on the backend.

Do not rely on hidden frontend controls.

## Privileged-account protection

Implement:

- MFA for platform administrators
- MFA enrolment
- MFA verification
- Recovery codes
- Secure MFA reset
- Privileged session management
- Strong reauthentication
- Administrator invitation
- Administrator deactivation
- Administrator revocation
- Audit logging
- Emergency access recovery procedure

Prefer standards-based TOTP or passkeys supported by the existing authentication architecture.

Never store recovery codes in plaintext.

Never create hardcoded emergency passwords.

Prevent public registration of platform administrators.

---

# 7. COMPLETE PLATFORM SUPER ADMIN

Build a production-quality platform operations console.

## Organisation management

Support:

- Organisation directory
- Search
- Filtering
- Pagination
- Organisation details
- Onboarding status
- Active membership counts
- Usage summaries
- Suspension
- Reactivation
- Administrative audit history

## Platform administration

Support:

- Administrator invitations
- Administrator roles
- Administrator revocation
- MFA status
- Security events
- Platform settings
- Feature flags where justified
- Operational announcements

## Operational monitoring

Implement visibility into:

- Failed background jobs
- Email delivery failures
- Queue backlog
- API errors
- Authentication failures
- Database connectivity
- Storage availability
- Scheduled job execution
- Backup health where available

Use real monitoring data.

Do not fabricate health metrics.

## Support workflows

Implement a controlled support process.

Support personnel should be able to:

- Find organisations
- Review non-sensitive account status
- Inspect relevant operational errors
- Review failed invitation deliveries
- Assist with onboarding problems

Exceptional access to tenant information must require explicit authorisation, narrow scope, expiration and audit logging.

Do not implement unrestricted impersonation.

## Subscription management

Implement the missing subscription domain.

Support:

- Plan catalogue
- Plan entitlements
- Organisation subscription status
- Trial periods where configured
- Seat limits
- Usage tracking
- Renewal dates
- Subscription history
- Upgrade and downgrade requests
- Cancellation lifecycle
- Suspended or expired subscription states

Separate subscription records from actual payment processing.

Do not invent prices, tax rates or payment-provider credentials.

If a billing provider is not configured, implement subscription records and entitlement enforcement without falsely claiming that payments are processed.

Do not activate paid subscriptions based solely on unverified frontend responses.

---

# 8. COMPLETE ATTENDANCE MANAGEMENT

In addition to the known defect fixes, complete:

- Clock in
- Clock out
- Multiple work sessions
- Break handling where configured
- Attendance history
- Attendance correction requests
- Correction approval
- Correction rejection
- Manager attendance view
- HR attendance view
- Schedule assignment
- Late-arrival calculations
- Absence calculations
- Overtime classification
- Incomplete-session handling
- Attendance exports
- Attendance analytics

Use authoritative server timestamps.

Support overnight shifts.

Prevent overlapping sessions.

Ensure concurrent requests cannot create duplicate active sessions.

Do not infer physical office presence from a clock-in event unless a separate verified attendance mechanism exists.

Create a single source of truth for attendance calculations.

---

# 9. COMPLETE LEAVE MANAGEMENT

Implement the entire leave lifecycle.

Support:

- Manual allocation
- Accrual
- Carry-over
- Prorating
- Request submission
- Approval
- Rejection
- Cancellation
- Approval reversal
- Balance adjustment
- Leave expiration
- Policy versioning
- Configurable approval chains
- Manager escalation
- Leave calendars
- Employee leave history
- Company leave reports

Prevent:

- Double deductions
- Duplicate approvals
- Invalid overlapping leave
- Negative balances where prohibited
- Unauthorised approvals
- Cross-tenant access

Use transactions and immutable adjustment history where appropriate.

Test policy changes during an active leave year.

---

# 10. COMPLETE RECRUITMENT & ONBOARDING

## Recruitment

Support:

- Job creation
- Job editing
- Job closure
- Candidate applications
- CV upload
- Candidate stages
- Interview scheduling
- Interview feedback
- Offer creation
- Offer acceptance
- Candidate rejection
- Candidate withdrawal
- Candidate conversion to employee

Preserve recruitment history.

## Onboarding templates

Implement:

- Configurable onboarding templates
- Role-specific templates
- Department-specific templates
- Task deadlines
- Task owners
- Employee-required tasks
- HR-required tasks
- Manager-required tasks
- Reminders
- Escalations
- Completion tracking

Ensure reminders are idempotent and do not repeatedly spam users.

---

# 11. COMPLETE OFFBOARDING

Support:

- Resignation recording
- Termination recording
- Scheduled departure
- Last working day
- Exit approval
- Exit checklist
- Asset return
- Document handover
- Final payroll review
- Access revocation
- Exit completion
- Historical retention

Distinguish immediate termination from scheduled departure.

For scheduled departure, access must remain governed by policy until the approved revocation time.

For immediate termination, revoke access promptly and reliably.

Use secure background jobs where appropriate.

Prevent accidental revocation of unrelated organisation memberships.

Do not delete historical employment records.

---

# 12. COMPLETE PAYROLL

Payroll must become a coherent, controlled workflow.

## Payroll setup

Support:

- Salary structures
- Compensation components
- Allowances
- Deductions
- Bonuses
- Employee compensation history
- Payroll periods
- Pay schedules

## Payroll runs

Implement:

1. Create payroll period
2. Generate draft payroll run
3. Calculate employee payroll items
4. Apply approved adjustments
5. Validate totals
6. Submit for review
7. Independent approval
8. Lock approved payroll
9. Record payment initiation where integrated
10. Mark paid only with authorised evidence
11. Reconcile payment records
12. Generate payslips
13. Close payroll period

Statuses should reflect actual workflow stages.

Use explicit state transitions.

Prevent invalid transitions.

## Financial correctness

- Use decimal-safe monetary calculations
- Define currency per payroll record
- Prevent duplicate payroll items
- Prevent duplicate approval
- Preserve adjustment history
- Prevent unauthorised salary changes
- Protect confidential compensation data
- Audit sensitive operations

## Payslips

Generate secure payslips containing:

- Employee details
- Payroll period
- Earnings
- Deductions
- Net pay
- Currency
- Employer information

Payslips must be available only to authorised users.

## Statutory deductions

Do not invent tax or pension rules.

Make statutory calculation engines configurable and implement only verified requirements.

## Payment integrations

Do not initiate live salary transfers without an approved payment provider and explicit transaction authorisation.

A payroll record marked Paid must have valid supporting evidence.

---

# 13. COMPLETE PERFORMANCE MANAGEMENT

Support:

- Review cycles
- Cycle configuration
- Employee goals
- KPI tracking
- Self-assessment
- Manager assessment
- Review deadlines
- Reminders
- Review approval
- Calibration where configured
- Development plans
- Review history
- Performance reporting

Ensure employee and manager permissions are correctly scoped.

Do not allow employees to edit submitted manager assessments.

Preserve historical review records.

---

# 14. COMPLETE DOCUMENT MANAGEMENT

Implement a proper document lifecycle.

Support:

- Secure upload
- Document categorisation
- Ownership
- Private download
- Document versioning
- Replacement history
- Archiving
- Retention policies
- Controlled deletion
- Access audit events
- Malware scanning
- File validation
- Size limits
- Content-type validation

Use durable private object storage suitable for production.

Do not store confidential files in publicly accessible directories.

Do not rely on temporary local filesystem storage for production documents.

Implement safe handling for failed uploads and orphaned objects.

---

# 15. COMPLETE COMPANY ASSET MANAGEMENT

Support:

- Asset creation
- Asset editing
- Asset categories
- Serial numbers
- Asset assignment
- Asset return
- Asset condition
- Maintenance status
- Lost asset reporting
- Asset history
- Employee asset overview
- Offboarding asset reconciliation
- Asset reports

Prevent duplicate active assignment of the same asset.

Preserve historical assignments.

---

# 16. COMPLETE NOTIFICATIONS & EMAIL

Existing implementation includes Zoho API sending, queued jobs, retries and in-app notifications.

Complete the remaining reliability work.

## Email delivery

Implement:

- Provider response validation
- Delivery status tracking
- Bounce handling
- Failure webhooks where supported
- Webhook signature verification
- Retry policies
- Dead-letter handling
- Delivery error classification
- Provider configuration checks

## Obsolete queued messages

Ensure queued jobs are revalidated before sending.

Examples:

- Revoked invitation
- Expired invitation
- Cancelled onboarding
- Removed employee
- Superseded password reset
- Already completed reminder

Do not send obsolete messages.

## In-app notifications

Support:

- Notification list
- Read/unread status
- Mark as read
- Mark all as read
- Relevant deep links
- Pagination
- Notification preferences

All notifications must be tenant-scoped and permission-aware.

---

# 17. COMPLETE REPORTING & ANALYTICS

Build a consistent reporting framework.

## Reports

Implement:

- Workforce report
- Headcount report
- Attendance report
- Absence report
- Leave report
- Recruitment report
- Payroll report
- Performance report
- Training report
- Asset report
- Onboarding report
- Offboarding report

## Reporting standards

Every report must support appropriate:

- Date filters
- Department filters
- Employee filters
- Status filters
- Pagination
- CSV export
- PDF export where appropriate
- Permission enforcement
- Organisation isolation
- Consistent timezone handling

Reports and dashboards must use the same underlying business rules.

## Weekly HR reports

Implement scheduled weekly HR reporting.

Include:

1. Executive summary
2. Employee headcount
3. Hires and exits
4. Recruitment activity
5. Attendance and absence
6. Leave requests
7. Payroll status
8. Performance updates
9. Training updates
10. Onboarding and offboarding
11. Company assets
12. Outstanding HR actions

Never invent missing data.

If a section lacks source records, explicitly report that the information is unavailable.

Support historical report snapshots and previous-period comparisons.

Protect confidential data in exports.

---

# 18. COMPLETE TRAINING & TASK MANAGEMENT

## Training

Support:

- Training programme creation
- Employee enrolment
- Training assignment
- Deadlines
- Completion status
- Certificates
- Training history
- Training reports

## Tasks

Support:

- Task creation
- Assignment
- Priority
- Deadline
- Status updates
- Comments
- Completion
- Overdue tracking
- Manager review
- Task history

Ensure managers can only manage tasks within their authorised scope.

Ensure task statistics reflect real persisted records.

---

# 19. PRODUCTION INFRASTRUCTURE

Complete the operational foundation.

## Deployment

Implement:

- Automated lint checks
- TypeScript checks
- Automated tests
- Production build checks
- Migration validation
- Deployment health checks
- Safe deployment procedures
- Rollback documentation

## Monitoring

Implement:

- Structured application logs
- API error monitoring
- Background job monitoring
- Database health monitoring
- Email delivery monitoring
- Storage monitoring
- Security event monitoring
- Alert thresholds

Avoid logging secrets or confidential employee information.

## Backups

Implement and document:

- Scheduled database backups
- Backup retention
- Secure backup storage
- Backup failure alerts
- Restoration procedure
- Restoration testing

Do not claim backups are reliable until restoration has been tested successfully.

## Background jobs

Ensure:

- Idempotent execution
- Safe retries
- Job status visibility
- Failure recovery
- No duplicate payroll processing
- No duplicate scheduled report generation
- No obsolete invitation delivery

## Configuration

Validate required environment variables at startup.

Separate development, testing, staging and production configuration.

Never commit credentials or secrets.

---

# 20. PERFORMANCE BENCHMARKING

Create realistic load-testing scenarios.

Test company sizes:

- 10 employees
- 100 employees
- 500 employees
- 1,000 employees
- 5,000 employees
- 10,000 employees

Test concurrent activity:

- Employee logins
- Clock-in requests
- Clock-out requests
- Attendance summaries
- Leave submissions
- Manager approvals
- Dashboard loading
- Report generation

Measure:

- p50 latency
- p95 latency
- p99 latency
- Error rate
- Database query duration
- Memory usage
- CPU usage
- Throughput

Identify actual bottlenecks.

Optimise based on measurements.

Document benchmark environment, test data and results.

Do not claim a performance target was achieved without measured evidence.

---

# 21. COMPLETE END-TO-END ACCEPTANCE TESTING

Create automated browser tests for the complete SaaS journey.

## Scenario A — Company registration

Homepage → Registration → Verification → Onboarding → Dashboard

## Scenario B — Company setup

Create Department → Configure Schedule → Configure Leave → Invite Employee

## Scenario C — Employee invitation

Invitation Sent → Accepted → Account Created → Onboarding Completed → Employee Dashboard

## Scenario D — Attendance

Clock In → Company Dashboard Updates → Clock Out → Attendance History → Reports

## Scenario E — Leave

Employee Request → Manager Approval → Balance Update → Dashboard Update → Report

## Scenario F — Tasks

Manager Assignment → Employee Progress → Completion → Manager Review

## Scenario G — Recruitment

Job Opening → Candidate → Interview → Offer → Acceptance → Employee Conversion

## Scenario H — Payroll

Payroll Draft → Adjustments → Review → Approval → Paid Evidence → Reconciliation → Payslip

## Scenario I — Offboarding

Exit Initiation → Checklist → Asset Return → Final Payroll Review → Access Revocation

## Scenario J — Platform Administration

Platform Login → Company Directory → Organisation Review → Suspension → Reactivation → Audit

## Scenario K — Tenant Isolation

Company A must not access Company B's employees, attendance, payroll, documents, reports or assets.

## Scenario L — Security

Test:

- Unauthorised access
- Expired sessions
- Role changes
- Revoked invitations
- Duplicate submissions
- MFA recovery
- Cross-tenant access attempts
- Suspended organisations
- Invalid workflow transitions

Run tests against isolated development or staging databases.

Do not perform destructive tests against production.

---

# 22. UI/UX FINAL QUALITY PASS

Maintain the current blue-and-white premium design.

Review every page for:

- Consistent typography
- Consistent spacing
- Correct navigation
- Working dropdowns
- Functional buttons
- Accessible forms
- Loading states
- Error states
- Empty states
- Confirmation dialogs
- Mobile responsiveness
- Keyboard accessibility
- Clear success messages
- No misleading statistics
- No clipped tables
- No overlapping elements
- No broken links

The application must remain extremely clean and easy to use.

Do not add unnecessary screens.

Prefer clear workflows over excessive configuration.

Every screen should help the user complete a meaningful task.

---

# 23. FINAL VERIFICATION GATES

Before declaring completion, verify:

## Engineering

- Lint passes
- TypeScript passes
- Production build passes
- Unit tests pass
- Integration tests pass
- End-to-end tests pass
- Database migrations are valid

## Functionality

- Company onboarding works
- Invitations work
- Employee login works
- Attendance works
- Leave works
- Tasks work
- Payroll workflows work
- Recruitment works
- Offboarding works
- Reporting works
- Platform administration works

## Security

- Tenant isolation verified
- Role permissions verified
- Privileged MFA verified
- Sensitive document access verified
- Session revocation verified
- Audit logs verified

## Operations

- Monitoring configured
- Job failures observable
- Backup process configured
- Restoration tested
- Deployment checks configured
- Rollback procedure documented

## Performance

- Benchmarks executed
- Bottlenecks documented
- Critical bottlenecks resolved
- No silent record truncation
- No unbounded queries in critical endpoints

If any gate fails, report it explicitly.

---

# 24. EXECUTION STRATEGY

Do not attempt a giant rewrite.

Work in small, verifiable phases.

For each phase:

1. Inspect existing implementation.
2. Identify precise gaps.
3. Design the smallest correct solution.
4. Implement backend changes.
5. Implement frontend changes.
6. Add database migrations where necessary.
7. Add automated tests.
8. Run verification.
9. Fix failures.
10. Update the completion checklist.
11. Continue to the next phase.

Do not repeatedly ask for confirmation for ordinary implementation decisions.

Use existing conventions and make sensible engineering choices.

However, request approval before:

- Destructive database changes
- Production deployment
- Production data migration
- Live payment integration
- Sending real external messages
- Irreversible security or account operations

If the execution environment imposes time or context limits, save progress in the checklist and continue from the next incomplete requirement in the next session.

Never claim work has been completed merely because it was planned.

---

# 25. REQUIRED FINAL ENGINEERING REPORT

When implementation work is complete, produce:

## A. Completion summary

List every completed module and verified workflow.

## B. Defects fixed

Explain the root cause and correction of each known defect.

## C. Database changes

List migrations, constraints and indexes.

## D. Security improvements

Describe permissions, MFA, session management and tenant isolation.

## E. Performance results

Provide actual benchmark results with test conditions.

## F. Test results

Report exact tests executed, passed, failed and skipped.

## G. Operational readiness

Describe monitoring, backups, deployment checks and restoration evidence.

## H. Remaining limitations

List anything incomplete or blocked.

Do not hide limitations.

---

# FINAL ENGINEERING DIRECTIVE

FlurryHR must become a complete, connected and reliable multi-tenant Human Resources SaaS platform.

We already have the foundation.

Do not rebuild it.

Finish it.

Fix the existing defects.

Complete every outstanding workflow.

Secure privileged accounts.

Make attendance calculations consistent.

Remove pagination limits.

Improve database efficiency.

Complete company administration.

Complete employee self-service.

Complete leave policies.

Complete payroll and payslips.

Complete recruitment and onboarding.

Complete offboarding.

Complete platform administration.

Complete notifications and reporting.

Establish production monitoring, backups and deployment checks.

Test the full journey across multiple organisations and user roles.

Maintain the existing exceptionally clean blue-and-white interface.

**Every action must validate, enforce permissions, persist correctly, update dependent views, handle failures honestly and remain correct under concurrent usage.**

Do not consider the project finished until every requirement in the completion checklist is either VERIFIED with evidence or explicitly BLOCKED with a documented reason.

Start immediately by auditing the existing repository and fixing the known attendance correctness and pagination defects.

Then proceed systematically through the remaining requirements.

The objective is not merely to pass tests.

**The objective is to deliver a dependable, secure, scalable and beautifully designed HR platform that real companies can use every working day.**
