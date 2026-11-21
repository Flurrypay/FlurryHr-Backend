import { Injectable, Inject, BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { DateTime } from "luxon";
import { Db } from "./db";
import { Actor, companyId, ownEmployee } from "./auth";
import { ADMIN } from "./domain";
import { pagination, rawCursor, readRawCursor } from "./pagination";
export interface AttendanceDay {
  employee: {
    id: string;
    firstName: string;
    lastName: string;
    jobTitle: string;
    department: string;
  };
  status: string;
  clockIn: string | null;
  clockOut: string | null;
  recordedMinutes: number;
  timezone: string;
  workDate: string;
  sessionCount: number;
  activeSessions: number;
  incompleteSessions: number;
}
export const attendanceStatuses = [
  "Incomplete Session",
  "Late",
  "Present",
  "On Leave",
  "Holiday",
  "Rest Day",
  "Absent",
  "Not started",
];
@Injectable()
export class AttendanceCalculation {
  constructor(@Inject(Db) private db: Db) {}
  date(actor: Actor, date?: string) {
    const value =
      date || DateTime.now().setZone(actor.organization!.timezone).toISODate()!;
    if (
      typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !DateTime.fromISO(value).isValid
    )
      throw new BadRequestException("Choose a valid YYYY-MM-DD date");
    return value;
  }
  // One classification source for daily summary and dashboard. All raw SQL is
  // explicitly scoped by the authenticated membership's organization.
  dataset(
    actor: Actor,
    date: string,
    query: Record<string, string>,
    now = new Date(),
    live = false,
  ): Prisma.Sql {
    const org = companyId(actor),
      scope = ADMIN.includes(actor.role)
        ? Prisma.empty
        : actor.role === "MANAGER"
          ? Prisma.sql`AND (e.id=${ownEmployee(actor)} OR e."managerId"=${ownEmployee(actor)})`
          : Prisma.sql`AND e.id=${ownEmployee(actor)}`;
    const local = Prisma.sql`(${now.toISOString()}::timestamptz AT TIME ZONE s.timezone)`;
    const day = live
      ? Prisma.sql`to_char(${local}::date - CASE WHEN s."endMinute"<=s."startMinute" AND extract(hour FROM ${local})*60+extract(minute FROM ${local})<s."endMinute" THEN 1 ELSE 0 END,'YYYY-MM-DD')`
      : Prisma.sql`${date}`;
    const lower = live
      ? DateTime.fromJSDate(now, { zone: "UTC" })
          .minus({ days: 2 })
          .toISODate()!
      : date;
    const upper = live
      ? DateTime.fromJSDate(now, { zone: "UTC" }).plus({ days: 1 }).toISODate()!
      : date;
    return Prisma.sql`
      WITH base AS (
        SELECT (${day})::text AS work_date,e.id,e."firstName",e."lastName",e."jobTitle",d.name AS department,
          COALESCE(a.sessions,0) AS sessions,a.first_in,a.last_out,COALESCE(a.active,0) AS active,COALESCE(a.incomplete,0) AS incomplete,COALESCE(a.minutes,0) AS minutes,a.late,
          COALESCE(a.rules,jsonb_build_object('timezone',s.timezone,'workingDays',s."workingDays",'startMinute',s."startMinute",'endMinute',s."endMinute",'graceMinutes',s."graceMinutes")) AS rules,
          EXISTS(SELECT 1 FROM "Holiday" h WHERE h."organizationId"=${org} AND h.date=${day}) AS holiday,
          EXISTS(SELECT 1 FROM "LeaveRequest" l WHERE l."organizationId"=${org} AND l."employeeId"=e.id AND l.status='Approved' AND l."startDate"<=${day} AND l."endDate">=${day}) AS on_leave
        FROM "Employee" e
        JOIN "Department" d ON d.id=e."departmentId" AND d."organizationId"=${org}
        JOIN "Schedule" s ON s.id=e."scheduleId" AND s."organizationId"=${org}
        LEFT JOIN (
          SELECT a."employeeId",a."workDate",count(*)::int AS sessions,min(a."clockIn") AS first_in,
            CASE WHEN count(*) FILTER(WHERE a."clockOut" IS NULL)=0 THEN max(a."clockOut") END AS last_out,
            count(*) FILTER(WHERE a."clockOut" IS NULL)::int AS active,
            count(*) FILTER(WHERE a."clockOut" IS NULL AND a."clockIn"<(${now.toISOString()}::timestamptz AT TIME ZONE 'UTC')-interval '24 hours')::int AS incomplete,
            COALESCE(sum(floor(extract(epoch FROM (a."clockOut"-a."clockIn"))/60)) FILTER(WHERE a."clockOut" IS NOT NULL),0)::int AS minutes,
            bool_or(a.status='Late') AS late,
            (array_agg(a."scheduleSnapshot" ORDER BY a."clockIn",a.id))[1] AS rules
          FROM "Attendance" a WHERE a."organizationId"=${org} AND a."workDate">=${lower} AND a."workDate"<=${upper}
            ${live ? Prisma.sql`AND a."clockIn"<=(${now.toISOString()}::timestamptz AT TIME ZONE 'UTC')` : Prisma.empty}
            GROUP BY a."employeeId",a."workDate"
        ) a ON a."employeeId"=e.id AND a."workDate"=${day}
        WHERE e."organizationId"=${org} AND e."joinedAt"<=(${day})::date
          AND (e.status='Active' OR a.sessions>0) ${scope}
          ${query.department ? Prisma.sql`AND e."departmentId"=${query.department}` : Prisma.empty}
          ${query.employee ? Prisma.sql`AND e.id=${query.employee}` : Prisma.empty}
          ${query.search ? Prisma.sql`AND concat_ws(' ',e."firstName",e."lastName",e.email) ILIKE ${"%" + query.search.slice(0, 100) + "%"}` : Prisma.empty}
      ), classified AS (
        SELECT *, CASE
          WHEN incomplete>0 THEN 'Incomplete Session'
          WHEN sessions>0 THEN CASE WHEN late THEN 'Late' ELSE 'Present' END
          WHEN on_leave THEN 'On Leave'
          WHEN holiday THEN 'Holiday'
          WHEN NOT (rules->'workingDays' @> to_jsonb(extract(isodow FROM work_date::date)::int)) THEN 'Rest Day'
          WHEN ${now.toISOString()}::timestamptz > ((work_date::date + ((rules->>'startMinute')::int+(rules->>'graceMinutes')::int)*interval '1 minute') AT TIME ZONE (rules->>'timezone')) THEN 'Absent'
          ELSE 'Not started' END AS status
        FROM base
      ) SELECT jsonb_build_object('id',id,'firstName',"firstName",'lastName',"lastName",'jobTitle',"jobTitle",'department',department) AS employee,
        status, to_char(first_in,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "clockIn",to_char(last_out,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "clockOut",minutes AS "recordedMinutes",
        rules->>'timezone' AS timezone, work_date AS "workDate", sessions AS "sessionCount",active AS "activeSessions",incomplete AS "incompleteSessions",id,"firstName","lastName",holiday,on_leave
        FROM classified`;
  }
  async page(actor: Actor, query: Record<string, string>) {
    const date = this.date(actor, query.date),
      { page, limit, skip } = pagination(query);
    if (query.status && !attendanceStatuses.includes(query.status))
      throw new BadRequestException("Unknown attendance status");
    const cursorScope = JSON.stringify([
      companyId(actor),
      actor.role,
      actor.employee?.id,
      date,
      query.department || "",
      query.employee || "",
      query.search || "",
      query.status || "",
    ]);
    const after = readRawCursor(query.after, cursorScope, 3);
    const [result] = await this.db.system.$queryRaw<
      { items: AttendanceDay[]; total: number }[]
    >(Prisma.sql`
      WITH rows AS (${this.dataset(actor, date, query)}), filtered AS (SELECT * FROM rows ${query.status ? Prisma.sql`WHERE status=${query.status}` : Prisma.empty}),
      page AS (SELECT * FROM filtered ${after ? Prisma.sql`WHERE ("firstName","lastName",id)>(${after[0]},${after[1]},${after[2]})` : Prisma.empty} ORDER BY "firstName","lastName",id LIMIT ${limit} OFFSET ${after ? 0 : skip})
      SELECT COALESCE((SELECT jsonb_agg(to_jsonb(page) - 'id' - 'firstName' - 'lastName' - 'holiday' - 'on_leave' ORDER BY "firstName","lastName",id) FROM page),'[]'::jsonb) AS items,
        (SELECT count(*)::int FROM filtered) AS total`);
    const last = result.items.at(-1);
    return {
      ...result,
      page,
      limit,
      nextCursor: rawCursor(
        cursorScope,
        last && [
          last.employee.firstName,
          last.employee.lastName,
          last.employee.id,
        ],
      ),
    };
  }
  async trend(actor: Actor, dates: string[]) {
    const rows = await this.db.system.$queryRaw<
      { date: string; present: number; late: number }[]
    >(Prisma.sql`
      WITH rows AS (${Prisma.join(
        dates.map(
          (date) =>
            Prisma.sql`(${this.dataset(actor, this.date(actor, date), {})})`,
        ),
        " UNION ALL ",
      )})
      SELECT "workDate" AS date,count(*) FILTER(WHERE "sessionCount">0)::int AS present,
        count(*) FILTER(WHERE status='Late')::int AS late FROM rows GROUP BY "workDate"`);
    return dates.map((date) => ({
      day: DateTime.fromISO(date).toFormat("ccc"),
      date,
      present: rows.find((row) => row.date === date)?.present || 0,
      late: rows.find((row) => row.date === date)?.late || 0,
    }));
  }
  async counts(actor: Actor, date: string, now = new Date(), live = false) {
    const [result] = await this.db.system.$queryRaw<
      Record<string, number>[]
    >(Prisma.sql`
      WITH rows AS (${this.dataset(actor, this.date(actor, date), {}, now, live)}) SELECT
        count(*) FILTER(WHERE status='Absent')::int AS absent,
        count(*) FILTER(WHERE status='Late')::int AS late,
        count(*) FILTER(WHERE status IN ('Present','Late','Absent','Not started','Incomplete Session') AND NOT holiday AND NOT on_leave)::int AS expected,
        count(*) FILTER(WHERE status='On Leave')::int AS "onLeave",
        count(*) FILTER(WHERE "sessionCount">0)::int AS present,
        count(*) FILTER(WHERE "sessionCount">0 AND "activeSessions"=0)::int AS completed,
        count(*) FILTER(WHERE "activeSessions">0)::int AS "clockedIn",
        COALESCE(sum("incompleteSessions"),0)::int AS incomplete FROM rows`);
    return result;
  }
}
