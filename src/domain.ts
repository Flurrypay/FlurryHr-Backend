import { DateTime } from "luxon";
export const ADMIN = ["SUPER_ADMIN", "OWNER", "COMPANY_ADMIN", "HR_ADMIN"];
export const PEOPLE = [...ADMIN, "MANAGER"];
export const FINANCE = [...ADMIN, "FINANCE"];
export function workedMinutes(start: Date, end: Date): number {
  if (end <= start) throw new Error("Clock-out must follow clock-in");
  return Math.floor((end.getTime() - start.getTime()) / 60000);
}
export function workDays(
  start: string,
  end: string,
  workingDays: number[],
  holidays: string[],
): number {
  let day = DateTime.fromISO(start, { zone: "UTC" });
  const finish = DateTime.fromISO(end, { zone: "UTC" });
  if (
    !day.isValid ||
    !finish.isValid ||
    finish < day ||
    finish.diff(day, "days").days > 366
  )
    throw new Error("Choose a valid date range of up to one year");
  let days = 0;
  while (day <= finish) {
    if (
      workingDays.includes(day.weekday) &&
      !holidays.includes(day.toISODate()!)
    )
      days++;
    day = day.plus({ days: 1 });
  }
  return days;
}
export function arrivalStatus(
  now: Date,
  schedule: {
    timezone: string;
    startMinute: number;
    endMinute: number;
    graceMinutes: number;
  },
): string {
  const local = DateTime.fromJSDate(now, { zone: schedule.timezone });
  let date = local.toISODate()!;
  if (
    schedule.endMinute < schedule.startMinute &&
    local.hour * 60 + local.minute < schedule.endMinute
  )
    date = local.minus({ days: 1 }).toISODate()!;
  const start = shiftWindow(date, { ...schedule, workingDays: [] }).start;
  return local > start.plus({ minutes: schedule.graceMinutes })
    ? "Late"
    : "Present";
}
export function netPay(
  base: string,
  allowances: string,
  deductions: string,
): bigint {
  if (![base, allowances, deductions].every((x) => /^\d{1,15}$/.test(x)))
    throw new Error("Amounts must be positive integer minor units");
  const net = BigInt(base) + BigInt(allowances) - BigInt(deductions);
  if (net < 0n) throw new Error("Deductions exceed earnings");
  return net;
}
export interface WorkSchedule {
  timezone: string;
  workingDays: number[];
  startMinute: number;
  endMinute: number;
  graceMinutes: number;
}
export function shiftWindow(date: string, schedule: WorkSchedule) {
  const day = DateTime.fromISO(date, { zone: schedule.timezone }).startOf(
    "day",
  );
  if (!day.isValid) throw new Error("Invalid schedule date");
  // Scheduled minutes are wall-clock times, not elapsed minutes since midnight.
  // A DST transition must not turn a configured 09:00 shift into 08:00/10:00.
  const wallTime = (date: DateTime, minute: number) => {
    const value = DateTime.fromObject(
      {
        year: date.year,
        month: date.month,
        day: date.day,
        hour: Math.floor(minute / 60),
        minute: minute % 60,
      },
      { zone: schedule.timezone },
    );
    // Match PostgreSQL AT TIME ZONE: choose the later instant on a repeated
    // local time; a nonexistent local time advances by the DST gap.
    return value
      .getPossibleOffsets()
      .reduce(
        (latest, option) =>
          option.toMillis() > latest.toMillis() ? option : latest,
        value,
      );
  };
  const start = wallTime(day, schedule.startMinute);
  const end = wallTime(
    day.plus({ days: schedule.endMinute <= schedule.startMinute ? 1 : 0 }),
    schedule.endMinute,
  );
  return { day, start, end };
}
export function currentShift(now: Date, schedule: WorkSchedule) {
  const local = DateTime.fromJSDate(now, { zone: schedule.timezone });
  const date =
    schedule.endMinute <= schedule.startMinute &&
    local.hour * 60 + local.minute < schedule.endMinute
      ? local.minus({ days: 1 }).toISODate()!
      : local.toISODate()!;
  return shiftWindow(date, schedule);
}
export function dayAttendanceStatus(
  date: string,
  schedule: WorkSchedule,
  sessions: { clockIn: Date; clockOut: Date | null; status: string }[],
  onLeave: boolean,
  holiday: boolean,
  now = new Date(),
) {
  const shift = shiftWindow(date, schedule);
  if (
    sessions.some(
      (s) => !s.clockOut && now.getTime() - s.clockIn.getTime() > 24 * 3600000,
    )
  )
    return "Incomplete Session";
  if (sessions.length)
    return sessions.some((s) => s.status === "Late") ? "Late" : "Present";
  if (onLeave) return "On Leave";
  if (holiday) return "Holiday";
  if (!schedule.workingDays.includes(shift.day.weekday)) return "Rest Day";
  return DateTime.fromJSDate(now) >
    shift.start.plus({ minutes: schedule.graceMinutes })
    ? "Absent"
    : "Not started";
}
