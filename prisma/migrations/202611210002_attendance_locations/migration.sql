-- Additive; do not invent coordinates or geolocation evidence for existing data.
ALTER TABLE "Organization" ADD COLUMN "attendanceLocation" JSONB;
ALTER TABLE "Employee" ADD COLUMN "remoteWorkLocation" JSONB;
ALTER TABLE "Attendance" ADD COLUMN "locationVerification" JSONB;
