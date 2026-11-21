ALTER TABLE "User" ADD COLUMN "mfaSecretEncrypted" TEXT, ADD COLUMN "mfaEnabledAt" TIMESTAMP(3), ADD COLUMN "mfaLastUsedStep" BIGINT;
ALTER TABLE "Session" ADD COLUMN "mfaVerifiedAt" TIMESTAMP(3);
CREATE TABLE "MfaEnrollment" ("userId" TEXT PRIMARY KEY REFERENCES "User"(id) ON DELETE CASCADE,"secretEncrypted" TEXT NOT NULL,"expiresAt" TIMESTAMP(3) NOT NULL);
CREATE TABLE "MfaRecoveryCode" (id TEXT PRIMARY KEY,"userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,hash TEXT NOT NULL UNIQUE,"consumedAt" TIMESTAMP(3),"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX "MfaRecoveryCode_userId_consumedAt_idx" ON "MfaRecoveryCode"("userId","consumedAt");
