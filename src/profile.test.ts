import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { ProfileDto } from "./saas.dto";

test("profile accepts trimmed personal names and existing phone-only clients", async () => {
  const profile = plainToInstance(ProfileDto, {
    firstName: "  Ada  ",
    lastName: "  Okafor ",
    phone: "",
  });
  assert.equal((await validate(profile)).length, 0);
  assert.equal(profile.firstName, "Ada");
  assert.equal(profile.lastName, "Okafor");
  assert.equal(
    (await validate(plainToInstance(ProfileDto, { phone: "" }))).length,
    0,
  );
});

test("profile rejects blank first names and privileged or identity changes", async () => {
  for (const data of [
    { firstName: "   ", phone: "" },
    { firstName: "Ada", phone: "", role: "OWNER" },
    { phone: "", email: "other@example.com" },
    { phone: "", employeeId: "someone-else" },
    { phone: "", remoteWorkLocation: {} },
  ]) {
    assert.ok(
      (
        await validate(plainToInstance(ProfileDto, data), {
          whitelist: true,
          forbidNonWhitelisted: true,
        })
      ).length > 0,
    );
  }
});
