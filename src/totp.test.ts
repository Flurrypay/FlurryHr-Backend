import { test } from "node:test";
import assert from "node:assert/strict";
import {
  encodeBase32,
  totp,
  verifyTotp,
  newTotpSecret,
  newRecoveryCodes,
  recoveryDigest,
} from "./totp";
const secret = encodeBase32(Buffer.from("12345678901234567890"));
test("TOTP matches all six RFC 6238 SHA-1 reference vectors including dates after 2038", () => {
  for (const [seconds, code] of [
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"],
  ] as const)
    assert.equal(totp(secret, seconds, 8), code);
});
test("TOTP allows limited clock skew but refuses replay and malformed codes", () => {
  const now = 1234567890,
    code = totp(secret, now),
    step = BigInt(Math.floor(now / 30));
  assert.equal(verifyTotp(secret, code, null, now), step);
  assert.equal(verifyTotp(secret, code, step, now), null);
  assert.equal(verifyTotp(secret, code, null, now + 30), step);
  assert.equal(verifyTotp(secret, code, null, now + 90), null);
  assert.equal(verifyTotp(secret, "bad", null, now), null);
});
test("MFA secrets and recovery codes are independently random; recovery digests normalize presentation", () => {
  assert.notEqual(newTotpSecret(), newTotpSecret());
  const codes = newRecoveryCodes();
  assert.equal(new Set(codes).size, 10);
  for (const code of codes) {
    assert.equal(code.replaceAll("-", "").length, 32);
    assert.equal(
      recoveryDigest(code),
      recoveryDigest(code.toUpperCase().replaceAll("-", "")),
    );
    assert.notEqual(recoveryDigest(code), code);
  }
});
