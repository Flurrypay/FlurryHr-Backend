import { test } from "node:test";
import assert from "node:assert/strict";
import {
  workedMinutes,
  workDays,
  arrivalStatus,
  netPay,
  currentShift,
  dayAttendanceStatus,
} from "./domain";
test("overnight sessions calculate elapsed minutes across dates", () => {
  assert.equal(
    workedMinutes(
      new Date("2026-11-16T22:00:00Z"),
      new Date("2026-11-17T06:30:00Z"),
    ),
    510,
  );
});
test("elapsed duration is correct across DST transition", () => {
  assert.equal(
    workedMinutes(
      new Date("2026-11-01T00:00:00-04:00"),
      new Date("2026-11-01T04:00:00-05:00"),
    ),
    300,
  );
});
test("invalid durations are rejected", () => {
  assert.throws(() =>
    workedMinutes(new Date("2026-01-02"), new Date("2026-01-01")),
  );
});
test("leave excludes rest days and configured holidays", () => {
  assert.equal(
    workDays("2026-11-16", "2026-11-22", [1, 2, 3, 4, 5], ["2026-11-17"]),
    4,
  );
});
test("invalid and excessive leave date ranges are rejected", () => {
  assert.throws(() => workDays("bad", "bad", [1], []));
  assert.throws(() => workDays("2026-01-01", "2028-01-01", [1], []));
});
test("company timezone controls lateness and grace", () => {
  const schedule = {
    timezone: "Africa/Lagos",
    startMinute: 540,
    endMinute: 1020,
    graceMinutes: 15,
  };
  assert.equal(
    arrivalStatus(new Date("2026-11-17T08:14:00Z"), schedule),
    "Present",
  );
  assert.equal(
    arrivalStatus(new Date("2026-11-17T08:16:00Z"), schedule),
    "Late",
  );
});
test("overnight shift associates early morning arrival with previous start", () => {
  assert.equal(
    arrivalStatus(new Date("2026-11-17T00:00:00Z"), {
      timezone: "UTC",
      startMinute: 1320,
      endMinute: 360,
      graceMinutes: 15,
    }),
    "Late",
  );
});
test("payroll uses exact integer arithmetic for large monetary values", () => {
  assert.equal(netPay("999999999999999", "1", "2"), 999999999999998n);
  assert.throws(() => netPay("1.1", "0", "0"));
  assert.throws(() => netPay("100", "0", "101"));
});

test("overnight shift uses the previous working day after midnight", () => {
  const shift = currentShift(new Date("2026-11-21T01:00:00Z"), {
    timezone: "UTC",
    workingDays: [1, 2, 3, 4, 5],
    startMinute: 1320,
    endMinute: 360,
    graceMinutes: 15,
  });
  assert.equal(shift.day.toISODate(), "2026-11-20");
  assert.equal(shift.end.toISO(), "2026-11-21T06:00:00.000Z");
});
test("absence respects leave, holidays, rest days and the scheduled grace period", () => {
  const schedule = {
    timezone: "UTC",
    workingDays: [1, 2, 3, 4, 5],
    startMinute: 540,
    endMinute: 1020,
    graceMinutes: 15,
  };
  assert.equal(
    dayAttendanceStatus("2026-11-18", schedule, [], true, false),
    "On Leave",
  );
  assert.equal(
    dayAttendanceStatus("2026-11-18", schedule, [], false, true),
    "Holiday",
  );
  assert.equal(
    dayAttendanceStatus("2026-11-21", schedule, [], false, false),
    "Rest Day",
  );
  assert.equal(
    dayAttendanceStatus(
      "2026-11-18",
      schedule,
      [],
      false,
      false,
      new Date("2026-11-18T09:10:00Z"),
    ),
    "Not started",
  );
  assert.equal(
    dayAttendanceStatus(
      "2026-11-18",
      schedule,
      [],
      false,
      false,
      new Date("2026-11-18T09:16:00Z"),
    ),
    "Absent",
  );
});
test("abandoned sessions are incomplete rather than silently closed at midnight", () => {
  const schedule = {
    timezone: "UTC",
    workingDays: [1, 2, 3, 4, 5],
    startMinute: 540,
    endMinute: 1020,
    graceMinutes: 15,
  };
  assert.equal(
    dayAttendanceStatus(
      "2026-11-18",
      schedule,
      [
        {
          clockIn: new Date("2026-11-17T08:00:00Z"),
          clockOut: null,
          status: "Present",
        },
      ],
      false,
      false,
      new Date("2026-11-18T10:00:00Z"),
    ),
    "Incomplete Session",
  );
});
