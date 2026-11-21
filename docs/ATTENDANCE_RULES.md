# Attendance calculation rules

The `AttendanceCalculation` service supplies daily summary rows, dashboard counts/trends and CSV rows. Raw recorded attendance and approved payable time are separate concepts. No breaks, overtime approval or salary payable minutes are inferred from recorded elapsed time.

## Work-date assignment

A normal session belongs to its clock-in date in the captured schedule timezone, regardless of how late it starts. A session on an overnight schedule that starts before that schedule's end minute belongs to the previous local date. All other clock-ins belong to their local date. The overnight gap between the previous shift end and the next shift start follows this existing rule; explicit shift selection/rosters for ambiguous gap arrivals are not implemented.

The database trigger captures schedule timezone, workdays, start/end/grace/break settings and assigns workDate. Changes to clock-in time, including approved corrections, recalculate workDate from that immutable snapshot. New sessions capture current rules. Imported pre-snapshot records use `Legacy inferred at migration`; earlier schedule versions cannot be reconstructed. Historical absences without sessions still use the current schedule until effective-dated assignments are implemented.

## Day-status precedence

1. A session still open after 24 hours: Incomplete Session.
2. Any recorded sessions: Late if any recorded arrival is Late, otherwise Present. This includes sessions after scheduled shift end and preserves worked time on holidays/rest days. Calendar flags exclude holidays/rest/leave from expected attendance counts.
3. Without a session, approved leave: On Leave.
4. Otherwise configured holiday: Holiday.
5. Otherwise a non-working weekday: Rest Day.
6. Otherwise the shift start plus grace has passed: Absent.
7. Otherwise: Not started.

Multiple completed sessions sum each elapsed duration in whole minutes. Any open session keeps the day's final clock-out unset. An open session's ongoing duration is not silently finalized. Leave conflicts do not erase recorded sessions. New clock-ins during approved leave require HR reversal first.

Daily reports use the requested work date. Live dashboard counts derive each employee's current work date in their own schedule timezone, including the previous date during an overnight shift. PostgreSQL comparisons use explicit UTC instants, independent of the server timezone.

## Query and export bounds

Attendance is grouped by organization/workDate/employee in PostgreSQL. Search/status filtering, counting and pagination occur in the database; only one bounded page reaches the application. CSV exports stream bounded pages with backpressure instead of silently truncating at 10,000 rows. Maximum export date range remains 93 days. Workforce state/history and live roster policy improvements are tracked separately in the completion checklist.
