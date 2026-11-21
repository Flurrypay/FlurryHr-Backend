# Platform MFA and recovery

Platform identities are provisioned through the existing controlled CLI, never public registration. A correct password creates an identity session but does not authorize platform APIs until MFA enrollment/verification succeeds. `/platform-security` provides manual-key authenticator setup, challenge, recovery-code display, replacement and reset.

TOTP uses RFC 6238 SHA-1, 6 digits, 30-second steps and at most one adjacent step of skew. Last-used steps prevent replay; user-row locks serialize proof consumption. Encrypted secrets use the existing AES-256-GCM encryption facility and stable MAIL_ENCRYPTION_KEY. Preserve this key securely: it now protects queued mail and MFA secrets. Recovery codes are independently random 128-bit values stored only as SHA-256 digests. They are displayed once and consumed atomically.

Every platform session requires a second-factor verification within the last 30 minutes. Enrollment invalidates other sessions. Password changes and account/session revocation retain the existing global-identity boundaries. Platform account security actions also require the verified MFA session. MFA proof, enrollment, recovery, reset and failures are audited without secret/code contents.

If an authenticator is lost, sign in with the password and an unused recovery code. Reset requires the password plus an authenticator or recovery code, invalidates other sessions and existing recovery codes, and requires new enrollment before platform access resumes. Replacement recovery codes require a fresh authenticator proof. Store recovery codes offline, separate from the password.

If both authenticator and all recovery codes are lost, there is no unauthenticated bypass or emergency password. An organizational approval and identity-verification procedure for operator-assisted recovery is still required; it is tracked as an external policy dependency. Do not edit account security records or run ad hoc resets without explicit authorization and an audited procedure.

Algorithm reference: https://www.rfc-editor.org/rfc/rfc6238
