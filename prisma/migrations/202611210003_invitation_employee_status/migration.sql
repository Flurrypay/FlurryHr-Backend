-- Repair unaccepted employee placeholders from previously revoked/deleted invitations.
-- Retain employees, mail and audit history; never alter an established login account.
WITH latest AS (
  SELECT DISTINCT ON ("organizationId", "employeeId") "organizationId", "employeeId", status
  FROM "Invitation" ORDER BY "organizationId", "employeeId", "createdAt" DESC, id DESC
)
UPDATE "Employee" e SET status=CASE WHEN i.status='Deleted' THEN 'Removed' ELSE 'Not invited' END
FROM latest i WHERE e.id=i."employeeId" AND e."organizationId"=i."organizationId"
AND e."userId" IS NULL AND e.status='Invited' AND i.status IN ('Revoked','Deleted');
