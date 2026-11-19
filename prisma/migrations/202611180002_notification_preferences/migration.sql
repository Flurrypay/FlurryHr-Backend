ALTER TABLE "Organization" ADD COLUMN "emailNotifications" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Membership" ADD COLUMN "emailNotifications" BOOLEAN NOT NULL DEFAULT true;
