# Current permissions matrix

| Capability                         | Owner/legacy SUPER_ADMIN | Company admin/HR                    | Manager                          | Finance                     | Employee                 | Platform admin                 |
| ---------------------------------- | ------------------------ | ----------------------------------- | -------------------------------- | --------------------------- | ------------------------ | ------------------------------ |
| Company profile                    | Yes                      | Company admin only                  | No                               | No                          | No                       | No tenant bypass               |
| Employee/invitation administration | Yes                      | Yes; restricted role grants         | Direct-report view               | No                          | Own profile only         | No tenant bypass               |
| Change company membership roles    | Yes                      | No                                  | No                               | No                          | No                       | No tenant bypass               |
| Attendance review                  | Yes; no self approval    | Yes; no self approval               | Direct reports; no self approval | No                          | Own corrections          | No tenant bypass               |
| Leave review                       | Yes; no self approval    | Yes; no self approval               | Direct reports; no self approval | No                          | Own requests             | No tenant bypass               |
| Payroll                            | Yes                      | Yes under existing FINANCE role set | Own approved records             | Create/independent approval | Own approved records     | No tenant bypass               |
| Documents/assets                   | Company administration   | Company administration              | Own authorized resources         | Own authorized resources    | Own authorized resources | No tenant bypass               |
| Company suspension                 | No                       | No                                  | No                               | No                          | No                       | Password re-entry/reason/audit |

Current roles are fixed, one role per organization membership. Separate Platform Administrator/Department Head role domains, exhaustive action-by-action permission tests remain outstanding. This matrix documents current code, not approval of all existing product policy choices.

Platform API access additionally requires MFA enrollment and a proof within 30 minutes. Global account session revocation requires password reauthentication; platform identities must also have the recent MFA proof. MFA setup/challenge endpoints use identity authentication plus current password and restrict access to verified platform identities. MFA changes do not grant company membership.
