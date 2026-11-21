-- Additive: existing timestamps/statuses are preserved. Pre-migration schedule
-- history cannot be reconstructed; provenance explicitly identifies inferred rules.
ALTER TABLE "Attendance" ADD COLUMN "workDate" TEXT,
 ADD COLUMN "scheduleSnapshot" JSONB, ADD COLUMN "snapshotSource" TEXT;
UPDATE "Attendance" a SET
 "scheduleSnapshot"=jsonb_build_object('timezone',s.timezone,'workingDays',s."workingDays",'startMinute',s."startMinute",'endMinute',s."endMinute",'graceMinutes',s."graceMinutes",'breakMinutes',s."breakMinutes"),
 "snapshotSource"='Legacy inferred at migration',
 "workDate"=to_char((a."clockIn" AT TIME ZONE 'UTC' AT TIME ZONE s.timezone)::date -
 CASE WHEN s."endMinute"<=s."startMinute" AND extract(hour from (a."clockIn" AT TIME ZONE 'UTC' AT TIME ZONE s.timezone))*60+extract(minute from (a."clockIn" AT TIME ZONE 'UTC' AT TIME ZONE s.timezone))<s."endMinute" THEN 1 ELSE 0 END,'YYYY-MM-DD')
FROM "Employee" e JOIN "Schedule" s ON s.id=e."scheduleId" AND s."organizationId"=e."organizationId"
WHERE a."employeeId"=e.id AND a."organizationId"=e."organizationId";
CREATE INDEX "Attendance_organizationId_workDate_employeeId_idx" ON "Attendance"("organizationId","workDate","employeeId");
CREATE FUNCTION flurryhr_attendance_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rules jsonb; local_in timestamp;
BEGIN
 IF TG_OP='UPDATE' AND OLD."scheduleSnapshot" IS NOT NULL AND NEW."scheduleSnapshot" IS DISTINCT FROM OLD."scheduleSnapshot" THEN
   RAISE EXCEPTION 'Attendance schedule snapshots are immutable';
 END IF;
 IF NEW."scheduleSnapshot" IS NULL THEN
   SELECT jsonb_build_object('timezone',s.timezone,'workingDays',s."workingDays",'startMinute',s."startMinute",'endMinute',s."endMinute",'graceMinutes',s."graceMinutes",'breakMinutes',s."breakMinutes") INTO rules
   FROM "Employee" e JOIN "Schedule" s ON s.id=e."scheduleId" AND s."organizationId"=e."organizationId"
   WHERE e.id=NEW."employeeId" AND e."organizationId"=NEW."organizationId";
   IF rules IS NULL THEN RAISE EXCEPTION 'Missing organization-scoped schedule'; END IF;
   NEW."scheduleSnapshot"=rules;
   NEW."snapshotSource"='Captured at clock-in';
 END IF;
 local_in=NEW."clockIn" AT TIME ZONE 'UTC' AT TIME ZONE (NEW."scheduleSnapshot"->>'timezone');
 NEW."workDate"=to_char(local_in::date - CASE WHEN
   (NEW."scheduleSnapshot"->>'endMinute')::int <= (NEW."scheduleSnapshot"->>'startMinute')::int
   AND extract(hour FROM local_in)*60+extract(minute FROM local_in)<(NEW."scheduleSnapshot"->>'endMinute')::int
   THEN 1 ELSE 0 END,'YYYY-MM-DD');
 RETURN NEW;
END $$;
CREATE TRIGGER attendance_snapshot BEFORE INSERT OR UPDATE ON "Attendance"
FOR EACH ROW EXECUTE FUNCTION flurryhr_attendance_snapshot();
