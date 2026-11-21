-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "biometricAttendanceRequired" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "FaceEnrollment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL DEFAULT current_setting('app.organization_id', true),
    "employeeId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "referenceEncrypted" TEXT,
    "consentAt" TIMESTAMP(3) NOT NULL,
    "consentVersion" TEXT NOT NULL,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FaceEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FaceCheck" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL DEFAULT current_setting('app.organization_id', true),
    "employeeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "targetAttendanceId" TEXT,
    "enrollmentVersion" INTEGER NOT NULL,
    "providerSessionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Creating',
    "liveness" DOUBLE PRECISION,
    "similarity" DOUBLE PRECISION,
    "failureCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),
    "attendanceId" TEXT,

    CONSTRAINT "FaceCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FaceEnrollment_organizationId_status_createdAt_id_idx" ON "FaceEnrollment"("organizationId", "status", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "FaceEnrollment_organizationId_employeeId_key" ON "FaceEnrollment"("organizationId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "FaceCheck_providerSessionId_key" ON "FaceCheck"("providerSessionId");

-- CreateIndex
CREATE INDEX "FaceCheck_organizationId_employeeId_createdAt_id_idx" ON "FaceCheck"("organizationId", "employeeId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "FaceCheck_organizationId_status_expiresAt_idx" ON "FaceCheck"("organizationId", "status", "expiresAt");

-- AddForeignKey
ALTER TABLE "FaceEnrollment" ADD CONSTRAINT "FaceEnrollment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FaceEnrollment" ADD CONSTRAINT "FaceEnrollment_employeeId_organizationId_fkey" FOREIGN KEY ("employeeId", "organizationId") REFERENCES "Employee"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FaceCheck" ADD CONSTRAINT "FaceCheck_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FaceCheck" ADD CONSTRAINT "FaceCheck_employeeId_organizationId_fkey" FOREIGN KEY ("employeeId", "organizationId") REFERENCES "Employee"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

