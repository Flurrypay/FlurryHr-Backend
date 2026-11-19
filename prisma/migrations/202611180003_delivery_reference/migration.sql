ALTER TABLE "MailJob" ADD COLUMN "referenceId" TEXT;
CREATE INDEX "MailJob_organization_reference_idx" ON "MailJob" ("organizationId","referenceId");
