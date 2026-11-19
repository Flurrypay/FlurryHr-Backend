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
  let start = local.startOf("day").plus({ minutes: schedule.startMinute });
  if (
    schedule.endMinute < schedule.startMinute &&
    local.hour * 60 + local.minute < schedule.endMinute
  )
    start = start.minus({ days: 1 });
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
  const start = day.plus({ minutes: schedule.startMinute });
  const end = day.plus({
    days: schedule.endMinute <= schedule.startMinute ? 1 : 0,
    minutes: schedule.endMinute,
  });
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
  if (onLeave) return "On Leave";
  if (holiday) return "Holiday";
  if (!schedule.workingDays.includes(shift.day.weekday)) return "Rest Day";
  if (
    sessions.some(
      (s) => !s.clockOut && now.getTime() - s.clockIn.getTime() > 24 * 3600000,
    )
  )
    return "Incomplete Session";
  if (sessions.length)
    return sessions.some((s) => s.status === "Late") ? "Late" : "Present";
  return DateTime.fromJSDate(now) >
    shift.start.plus({ minutes: schedule.graceMinutes })
    ? "Absent"
    : "Not started";
}
