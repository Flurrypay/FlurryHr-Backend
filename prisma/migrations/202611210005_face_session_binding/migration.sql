ALTER TABLE "FaceCheck" ADD COLUMN "authSessionId" TEXT;
-- Legacy in-flight proofs cannot be replayed without an authenticated-session binding.
UPDATE "FaceCheck" SET status='Superseded' WHERE status IN ('Creating','Started','Verifying','Verified');
