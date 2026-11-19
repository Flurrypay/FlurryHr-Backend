ALTER TABLE "Attendance" ADD COLUMN "requestKey" TEXT;
CREATE UNIQUE INDEX "Attendance_requestKey_key" ON "Attendance" ("requestKey");
