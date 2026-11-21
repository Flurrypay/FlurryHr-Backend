import {
  createHmac,
  randomBytes,
  timingSafeEqual,
  createHash,
} from "node:crypto";
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function encodeBase32(bytes: Buffer) {
  let bits = 0,
    value = 0,
    result = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      result += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits) result += alphabet[(value << (5 - bits)) & 31];
  return result;
}
function decodeBase32(secret: string) {
  let bits = 0,
    value = 0;
  const result: number[] = [];
  for (const char of secret.toUpperCase().replace(/=+$/, "")) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw Error("Invalid TOTP secret");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      result.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(result);
}
export function newTotpSecret() {
  return encodeBase32(randomBytes(20));
}
export function totp(
  secret: string,
  seconds = Math.floor(Date.now() / 1000),
  digits = 6,
) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(seconds / 30)));
  const hmac = createHmac("sha1", decodeBase32(secret))
      .update(counter)
      .digest(),
    offset = hmac[hmac.length - 1] & 15;
  const value = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return String(value).padStart(digits, "0");
}
export function verifyTotp(
  secret: string,
  code: string,
  lastStep: bigint | null,
  seconds = Math.floor(Date.now() / 1000),
) {
  if (!/^\d{6}$/.test(code)) return null;
  const step = Math.floor(seconds / 30);
  for (const candidate of [step, step - 1, step + 1]) {
    if (lastStep !== null && BigInt(candidate) <= lastStep) continue;
    if (
      timingSafeEqual(
        Buffer.from(totp(secret, candidate * 30)),
        Buffer.from(code),
      )
    )
      return BigInt(candidate);
  }
  return null;
}
export function recoveryDigest(code: string) {
  return createHash("sha256")
    .update(code.replace(/-/g, "").trim().toLowerCase())
    .digest("hex");
}
export function newRecoveryCodes() {
  return Array.from({ length: 10 }, () =>
    randomBytes(16)
      .toString("hex")
      .match(/.{1,8}/g)!
      .join("-"),
  );
}
