-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "Role" ADD VALUE 'OWNER';
ALTER TYPE "Role" ADD VALUE 'COMPANY_ADMIN';

-- DropIndex
DROP INDEX "Department_name_key";

-- DropIndex
DROP INDEX "Schedule_name_key";

-- DropIndex
DROP INDEX "Holiday_date_key";

-- DropIndex
DROP INDEX "Employee_email_key";

-- DropIndex
DROP INDEX "Employee_userId_key";

-- DropIndex
DROP INDEX "LeaveType_name_key";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "platformAdmin" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "membershipId" TEXT;

-- AlterTable
ALTER TABLE "Department" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001';

-- AlterTable
ALTER TABLE "Schedule" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001';

-- AlterTable
ALTER TABLE "Holiday" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001';

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001';

-- AlterTable
ALTER TABLE "Attendance" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001';

-- AlterTable
ALTER TABLE "Correction" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001';

-- AlterTable
ALTER TABLE "LeaveType" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001';

-- AlterTable
ALTER TABLE "LeaveAllocation" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001';

-- AlterTable
ALTER TABLE "LeaveRequest" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001';

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001';

-- AlterTable
ALTER TABLE "Candidate" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001';

-- AlterTable
ALTER TABLE "OnboardingItem" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001';

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001';

-- AlterTable
ALTER TABLE "Payroll" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001';

-- AlterTable
ALTER TABLE "Announcement" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001';

-- AlterTable
ALTER TABLE "Audit" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001';

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "businessEmail" TEXT NOT NULL,
    "phone" TEXT,
    "country" TEXT NOT NULL DEFAULT 'NG',
    "timezone" TEXT NOT NULL DEFAULT 'Africa/Lagos',
    "address" TEXT NOT NULL DEFAULT '',
    "logo" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "onboardingStep" INTEGER NOT NULL DEFAULT 0,
    "onboardingCompleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT,
    "role" "Role" NOT NULL DEFAULT 'EMPLOYEE',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'EMPLOYEE',
    "employeeId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "invitedBy" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailJob" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "userId" TEXT,
    "to" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformAudit" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "organizationId" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001',
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT NOT NULL DEFAULT '/workspace',
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001',
    "taskId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001',
    "employeeId" TEXT,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001',
    "identifier" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "serialNumber" TEXT,
    "condition" TEXT NOT NULL DEFAULT 'Good',
    "status" TEXT NOT NULL DEFAULT 'Available',
    "employeeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetHistory" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001',
    "assetId" TEXT NOT NULL,
    "employeeId" TEXT,
    "action" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PerformanceReview" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001',
    "employeeId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "selfAssessment" TEXT NOT NULL DEFAULT '',
    "managerAssessment" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PerformanceReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE INDEX "Organization_status_createdAt_idx" ON "Organization"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_employeeId_key" ON "Membership"("employeeId");

-- CreateIndex
CREATE INDEX "Membership_organizationId_active_idx" ON "Membership"("organizationId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_organizationId_key" ON "Membership"("userId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountToken_hash_key" ON "AccountToken"("hash");

-- CreateIndex
CREATE INDEX "AccountToken_userId_kind_idx" ON "AccountToken"("userId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "Invitation"("tokenHash");

-- CreateIndex
CREATE INDEX "Invitation_organizationId_status_idx" ON "Invitation"("organizationId", "status");

-- CreateIndex
CREATE INDEX "MailJob_status_availableAt_idx" ON "MailJob"("status", "availableAt");

-- CreateIndex
CREATE INDEX "PlatformAudit_createdAt_idx" ON "PlatformAudit"("createdAt");

-- CreateIndex
CREATE INDEX "Notification_organizationId_userId_createdAt_idx" ON "Notification"("organizationId", "userId", "createdAt");

-- CreateIndex
CREATE INDEX "TaskEvent_organizationId_taskId_createdAt_idx" ON "TaskEvent"("organizationId", "taskId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Document_storageKey_key" ON "Document"("storageKey");

-- CreateIndex
CREATE INDEX "Document_organizationId_employeeId_idx" ON "Document"("organizationId", "employeeId");

-- CreateIndex
CREATE INDEX "Asset_organizationId_employeeId_idx" ON "Asset"("organizationId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_organizationId_identifier_key" ON "Asset"("organizationId", "identifier");

-- CreateIndex
CREATE INDEX "AssetHistory_organizationId_assetId_idx" ON "AssetHistory"("organizationId", "assetId");

-- CreateIndex
CREATE INDEX "PerformanceReview_organizationId_employeeId_idx" ON "PerformanceReview"("organizationId", "employeeId");

-- CreateIndex
CREATE INDEX "Department_organizationId_idx" ON "Department"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Department_id_organizationId_key" ON "Department"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Department_organizationId_name_key" ON "Department"("organizationId", "name");

-- CreateIndex
CREATE INDEX "Schedule_organizationId_idx" ON "Schedule"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Schedule_id_organizationId_key" ON "Schedule"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Schedule_organizationId_name_key" ON "Schedule"("organizationId", "name");

-- CreateIndex
CREATE INDEX "Holiday_organizationId_idx" ON "Holiday"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Holiday_id_organizationId_key" ON "Holiday"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Holiday_organizationId_date_key" ON "Holiday"("organizationId", "date");

-- CreateIndex
CREATE INDEX "Employee_organizationId_idx" ON "Employee"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_id_organizationId_key" ON "Employee"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_organizationId_email_key" ON "Employee"("organizationId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_organizationId_userId_key" ON "Employee"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "Attendance_organizationId_idx" ON "Attendance"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Attendance_id_organizationId_key" ON "Attendance"("id", "organizationId");

-- CreateIndex
CREATE INDEX "Correction_organizationId_idx" ON "Correction"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Correction_id_organizationId_key" ON "Correction"("id", "organizationId");

-- CreateIndex
CREATE INDEX "LeaveType_organizationId_idx" ON "LeaveType"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveType_id_organizationId_key" ON "LeaveType"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveType_organizationId_name_key" ON "LeaveType"("organizationId", "name");

-- CreateIndex
CREATE INDEX "LeaveAllocation_organizationId_idx" ON "LeaveAllocation"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveAllocation_id_organizationId_key" ON "LeaveAllocation"("id", "organizationId");

-- CreateIndex
CREATE INDEX "LeaveRequest_organizationId_idx" ON "LeaveRequest"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveRequest_id_organizationId_key" ON "LeaveRequest"("id", "organizationId");

-- CreateIndex
CREATE INDEX "Job_organizationId_idx" ON "Job"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Job_id_organizationId_key" ON "Job"("id", "organizationId");

-- CreateIndex
CREATE INDEX "Candidate_organizationId_idx" ON "Candidate"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Candidate_id_organizationId_key" ON "Candidate"("id", "organizationId");

-- CreateIndex
CREATE INDEX "OnboardingItem_organizationId_idx" ON "OnboardingItem"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "OnboardingItem_id_organizationId_key" ON "OnboardingItem"("id", "organizationId");

-- CreateIndex
CREATE INDEX "Task_organizationId_idx" ON "Task"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Task_id_organizationId_key" ON "Task"("id", "organizationId");

-- CreateIndex
CREATE INDEX "Payroll_organizationId_idx" ON "Payroll"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Payroll_id_organizationId_key" ON "Payroll"("id", "organizationId");

-- CreateIndex
CREATE INDEX "Announcement_organizationId_idx" ON "Announcement"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Announcement_id_organizationId_key" ON "Announcement"("id", "organizationId");

-- CreateIndex
CREATE INDEX "Audit_organizationId_idx" ON "Audit"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Audit_id_organizationId_key" ON "Audit"("id", "organizationId");

-- Preserve the original single-company workspace and identity permissions.
INSERT INTO "Organization" (id,name,slug,"businessEmail",country,timezone,address,status,"onboardingStep","onboardingCompleted","createdAt","updatedAt") VALUES ('00000000-0000-4000-8000-000000000001','FlurryPay','flurrypay','admin@flurrypay.com','NG','Africa/Lagos','','Active',6,true,now(),now());
UPDATE "User" SET "emailVerifiedAt"=now();
INSERT INTO "Membership" (id,"userId","organizationId","employeeId",role,active,"createdAt") SELECT 'legacy-'||u.id,u.id,'00000000-0000-4000-8000-000000000001',e.id,u.role,u.active,now() FROM "User" u LEFT JOIN "Employee" e ON e."userId"=u.id;
UPDATE "Session" SET "membershipId"='legacy-'||"userId";

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Holiday" ADD CONSTRAINT "Holiday_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Correction" ADD CONSTRAINT "Correction_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveType" ADD CONSTRAINT "LeaveType_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveAllocation" ADD CONSTRAINT "LeaveAllocation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingItem" ADD CONSTRAINT "OnboardingItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payroll" ADD CONSTRAINT "Payroll_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Audit" ADD CONSTRAINT "Audit_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountToken" ADD CONSTRAINT "AccountToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskEvent" ADD CONSTRAINT "TaskEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetHistory" ADD CONSTRAINT "AssetHistory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceReview" ADD CONSTRAINT "PerformanceReview_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "Department" ALTER COLUMN "organizationId" SET DEFAULT current_setting('app.organization_id', true);

ALTER TABLE "Schedule" ALTER COLUMN "organizationId" SET DEFAULT current_setting('app.organization_id', true);

ALTER TABLE "Holiday" ALTER COLUMN "organizationId" SET DEFAULT current_setting('app.organization_id', true);

ALTER TABLE "Employee" ALTER COLUMN "organizationId" SET DEFAULT current_setting('app.organization_id', true);

ALTER TABLE "Attendance" ALTER COLUMN "organizationId" SET DEFAULT current_setting('app.organization_id', true);

ALTER TABLE "Correction" ALTER COLUMN "organizationId" SET DEFAULT current_setting('app.organization_id', true);

ALTER TABLE "LeaveType" ALTER COLUMN "organizationId" SET DEFAULT current_setting('app.organization_id', true);

ALTER TABLE "LeaveAllocation" ALTER COLUMN "organizationId" SET DEFAULT current_setting('app.organization_id', true);

ALTER TABLE "LeaveRequest" ALTER COLUMN "organizationId" SET DEFAULT current_setting('app.organization_id', true);

ALTER TABLE "Job" ALTER COLUMN "organizationId" SET DEFAULT current_setting('app.organization_id', true);

ALTER TABLE "Candidate" ALTER COLUMN "organizationId" SET DEFAULT current_setting('app.organization_id', true);

ALTER TABLE "OnboardingItem" ALTER COLUMN "organizationId" SET DEFAULT current_setting('app.organization_id', true);

ALTER TABLE "Task" ALTER COLUMN "organizationId" SET DEFAULT current_setting('app.organization_id', true);

ALTER TABLE "Payroll" ALTER COLUMN "organizationId" SET DEFAULT current_setting('app.organization_id', true);

ALTER TABLE "Announcement" ALTER COLUMN "organizationId" SET DEFAULT current_setting('app.organization_id', true);

ALTER TABLE "Audit" ALTER COLUMN "organizationId" SET DEFAULT current_setting('app.organization_id', true);

ALTER TABLE "Notification" ALTER COLUMN "organizationId" SET DEFAULT current_setting('app.organization_id', true);

ALTER TABLE "TaskEvent" ALTER COLUMN "organizationId" SET DEFAULT current_setting('app.organization_id', true);

ALTER TABLE "Document" ALTER COLUMN "organizationId" SET DEFAULT current_setting('app.organization_id', true);

ALTER TABLE "Asset" ALTER COLUMN "organizationId" SET DEFAULT current_setting('app.organization_id', true);

ALTER TABLE "AssetHistory" ALTER COLUMN "organizationId" SET DEFAULT current_setting('app.organization_id', true);

ALTER TABLE "PerformanceReview" ALTER COLUMN "organizationId" SET DEFAULT current_setting('app.organization_id', true);

-- Composite foreign keys reject cross-company associations even outside the API.
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_id_org_unique" UNIQUE (id,"organizationId");
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_departmentId_tenant_fk" FOREIGN KEY ("departmentId","organizationId") REFERENCES "Department"(id,"organizationId") ON DELETE RESTRICT;
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_scheduleId_tenant_fk" FOREIGN KEY ("scheduleId","organizationId") REFERENCES "Schedule"(id,"organizationId") ON DELETE RESTRICT;
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_managerId_tenant_fk" FOREIGN KEY ("managerId","organizationId") REFERENCES "Employee"(id,"organizationId") ON DELETE RESTRICT;
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_employeeId_tenant_fk" FOREIGN KEY ("employeeId","organizationId") REFERENCES "Employee"(id,"organizationId") ON DELETE RESTRICT;
ALTER TABLE "Correction" ADD CONSTRAINT "Correction_attendanceId_tenant_fk" FOREIGN KEY ("attendanceId","organizationId") REFERENCES "Attendance"(id,"organizationId") ON DELETE RESTRICT;
ALTER TABLE "LeaveAllocation" ADD CONSTRAINT "LeaveAllocation_employeeId_tenant_fk" FOREIGN KEY ("employeeId","organizationId") REFERENCES "Employee"(id,"organizationId") ON DELETE RESTRICT;
ALTER TABLE "LeaveAllocation" ADD CONSTRAINT "LeaveAllocation_leaveTypeId_tenant_fk" FOREIGN KEY ("leaveTypeId","organizationId") REFERENCES "LeaveType"(id,"organizationId") ON DELETE RESTRICT;
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_employeeId_tenant_fk" FOREIGN KEY ("employeeId","organizationId") REFERENCES "Employee"(id,"organizationId") ON DELETE RESTRICT;
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_leaveTypeId_tenant_fk" FOREIGN KEY ("leaveTypeId","organizationId") REFERENCES "LeaveType"(id,"organizationId") ON DELETE RESTRICT;
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_jobId_tenant_fk" FOREIGN KEY ("jobId","organizationId") REFERENCES "Job"(id,"organizationId") ON DELETE RESTRICT;
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_employeeId_tenant_fk" FOREIGN KEY ("employeeId","organizationId") REFERENCES "Employee"(id,"organizationId") ON DELETE RESTRICT;
ALTER TABLE "OnboardingItem" ADD CONSTRAINT "OnboardingItem_employeeId_tenant_fk" FOREIGN KEY ("employeeId","organizationId") REFERENCES "Employee"(id,"organizationId") ON DELETE RESTRICT;
ALTER TABLE "Task" ADD CONSTRAINT "Task_employeeId_tenant_fk" FOREIGN KEY ("employeeId","organizationId") REFERENCES "Employee"(id,"organizationId") ON DELETE RESTRICT;
ALTER TABLE "Payroll" ADD CONSTRAINT "Payroll_employeeId_tenant_fk" FOREIGN KEY ("employeeId","organizationId") REFERENCES "Employee"(id,"organizationId") ON DELETE RESTRICT;
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_employeeId_tenant_fk" FOREIGN KEY ("employeeId","organizationId") REFERENCES "Employee"(id,"organizationId") ON DELETE RESTRICT;
ALTER TABLE "Document" ADD CONSTRAINT "Document_employeeId_tenant_fk" FOREIGN KEY ("employeeId","organizationId") REFERENCES "Employee"(id,"organizationId") ON DELETE RESTRICT;
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_employeeId_tenant_fk" FOREIGN KEY ("employeeId","organizationId") REFERENCES "Employee"(id,"organizationId") ON DELETE RESTRICT;
ALTER TABLE "AssetHistory" ADD CONSTRAINT "AssetHistory_employeeId_tenant_fk" FOREIGN KEY ("employeeId","organizationId") REFERENCES "Employee"(id,"organizationId") ON DELETE RESTRICT;
ALTER TABLE "AssetHistory" ADD CONSTRAINT "AssetHistory_assetId_tenant_fk" FOREIGN KEY ("assetId","organizationId") REFERENCES "Asset"(id,"organizationId") ON DELETE RESTRICT;
ALTER TABLE "PerformanceReview" ADD CONSTRAINT "PerformanceReview_employeeId_tenant_fk" FOREIGN KEY ("employeeId","organizationId") REFERENCES "Employee"(id,"organizationId") ON DELETE RESTRICT;
ALTER TABLE "TaskEvent" ADD CONSTRAINT "TaskEvent_taskId_tenant_fk" FOREIGN KEY ("taskId","organizationId") REFERENCES "Task"(id,"organizationId") ON DELETE RESTRICT;
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_identity_org_unique" UNIQUE (id,"organizationId","userId");
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_employee_identity_fk" FOREIGN KEY ("employeeId","organizationId","userId") REFERENCES "Employee"(id,"organizationId","userId");
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_membership_fk" FOREIGN KEY ("userId","organizationId") REFERENCES "Membership"("userId","organizationId");
CREATE UNIQUE INDEX "Invitation_one_pending" ON "Invitation" ("organizationId",email) WHERE status='Pending';
ALTER TABLE "Session" ADD CONSTRAINT "Session_membership_fk" FOREIGN KEY ("membershipId") REFERENCES "Membership"(id) ON DELETE CASCADE;
