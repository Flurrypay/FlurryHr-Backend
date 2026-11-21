import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { validate } from "class-validator";
import {
  WorkLocationDto,
  AttendancePositionDto,
  verifyPosition,
  locationValue,
} from "./work-location";
const now = Date.now();
const office = {
  address: "Approved Lagos office",
  latitude: 6.5244,
  longitude: 3.3792,
};
const position = { ...office, accuracy: 10, capturedAt: now };
test("location receipt accepts the approved centre without storing device coordinates", () => {
  const receipt = verifyPosition(position, office, "Company", now);
  assert.equal(receipt.radiusMetres, 100);
  assert.equal(receipt.distanceMetres, 0);
  assert.equal("latitude" in receipt, false);
  assert.equal("longitude" in receipt, false);
});
test("unconfigured and invalid approved locations fail closed", () => {
  for (const location of [
    null,
    {},
    { ...office, address: "   " },
    { ...office, latitude: 91 },
    { ...office, longitude: NaN },
  ]) {
    assert.equal(locationValue(location), null);
    assert.throws(
      () => verifyPosition(position, location, "Company", now),
      /Ask HR/,
    );
  }
});
test("outside, uncertain boundary, stale, future and inaccurate GPS readings are rejected", () => {
  for (const p of [
    { ...position, latitude: 6.53 },
    { ...position, latitude: office.latitude + 0.00085 },
    { ...position, accuracy: 51 },
    { ...position, capturedAt: now - 120001 },
    { ...position, capturedAt: now + 10001 },
    { ...position, latitude: NaN },
  ])
    assert.throws(() => verifyPosition(p, office, "Company", now));
});
test("remote point differs from office; remote attendance requires its assigned point", () => {
  const home = { ...office, address: "Approved remote home", latitude: 6.6 };
  assert.throws(
    () => verifyPosition(position, home, "Remote", now),
    /remote work/,
  );
  assert.equal(
    verifyPosition(
      { ...position, latitude: home.latitude },
      home,
      "Remote",
      now,
    ).kind,
    "Remote",
  );
});
test("DTO rejects missing, coerced and invalid GPS properties", async () => {
  for (const props of [
    {},
    { latitude: "6", longitude: 3, accuracy: 5, capturedAt: now },
    { latitude: 91, longitude: 181, accuracy: -1, capturedAt: 1.5 },
  ])
    assert.ok(
      (await validate(Object.assign(new AttendancePositionDto(), props)))
        .length,
    );
  assert.equal(
    (
      await validate(
        Object.assign(new AttendancePositionDto(), {
          latitude: 6,
          longitude: 3,
          accuracy: 5,
          capturedAt: now,
        }),
      )
    ).length,
    0,
  );
  assert.ok(
    (
      await validate(
        Object.assign(new WorkLocationDto(), { ...office, address: "abc" }),
      )
    ).length,
  );
});
test("longitude wraparound uses the short great-circle distance", () => {
  assert.ok(
    verifyPosition(
      { ...position, latitude: 0, longitude: -179.9999 },
      { ...office, latitude: 0, longitude: 179.9999 },
      "Company",
      now,
    ).distanceMetres < 30,
  );
});
