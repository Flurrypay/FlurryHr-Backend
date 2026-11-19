import {
  Controller,
  Get,
  Req,
  Res,
  Query,
  Inject,
  UseGuards,
  BadRequestException,
} from "@nestjs/common";
import { Response } from "express";
import { DateTime } from "luxon";
import { Db } from "./db";
import { AuthGuard, AuthRequest, ownEmployee, permit } from "./auth";
import { ADMIN, PEOPLE, FINANCE, workedMinutes, currentShift } from "./domain";
import { Prisma } from "@prisma/client";
@Controller()
@UseGuards(AuthGuard)
export class DashboardController {
  constructor(@Inject(Db) private db: Db) {}
  @Get("dashboard")
  async dashboard(@Req() req: AuthRequest) {
    const actor = req.actor;
    const zone = req.actor.organization!.timezone;
    const now = DateTime.now().setZone(zone),
      date = now.toISODate()!;
    const scope: Prisma.EmployeeWhereInput = ADMIN.includes(actor.role)
      ? {}
      : actor.role === "MANAGER"
        ? {
            OR: [{ managerId: ownEmployee(actor) }, { id: ownEmployee(actor) }],
          }
        : { id: ownEmployee(actor) };
    const employees = await this.db.employee.findMany({
      where: scope,
      include: { schedule: true, department: true },
    });
    const ids = employees.map((e) => e.id);
    const [
      sessions,
      leaves,
      pending,
      departments,
      announcements,
      tasks,
      activity,
      holidays,
    ] = await Promise.all([
      this.db.attendance.findMany({
        where: {
          employeeId: { in: ids },
          clockIn: { lte: now.endOf("day").toJSDate() },
          OR: [
            { clockOut: null },
            { clockOut: { gte: now.startOf("day").toJSDate() } },
          ],
        },
        include: {
          employee: {
            select: { firstName: true, lastName: true, jobTitle: true },
          },
        },
      }),
      this.db.leaveRequest.findMany({
        where: {
          employeeId: { in: ids },
          status: "Approved",
          startDate: { lte: now.plus({ days: 2 }).toISODate()! },
          endDate: { gte: now.minus({ days: 2 }).toISODate()! },
        },
      }),
      this.db.leaveRequest.count({
        where: { employeeId: { in: ids }, status: "Pending" },
      }),
      this.db.department.findMany({
        include: { _count: { select: { employees: { where: scope } } } },
      }),
      this.db.announcement.findMany({
        orderBy: { createdAt: "desc" },
        take: 3,
      }),
      this.db.task.findMany({
        where: { employeeId: { in: ids }, status: { not: "Completed" } },
        orderBy: { dueDate: "asc" },
        take: 4,
      }),
      this.db.audit.findMany({
        where: ADMIN.includes(actor.role) ? {} : { actorId: actor.id },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
      this.db.holiday.findMany({
        where: {
          date: {
            gte: now.minus({ days: 2 }).toISODate()!,
            lte: now.plus({ days: 2 }).toISODate()!,
          },
        },
      }),
    ]);
    const activeLeave = employees.filter((e) => {
      const day = currentShift(now.toJSDate(), e.schedule).day.toISODate()!;
      return leaves.some(
        (l) => l.employeeId === e.id && l.startDate <= day && l.endDate >= day,
      );
    });
    const expected = employees.filter((e) => {
      const shift = currentShift(now.toJSDate(), e.schedule);
      return (
        e.status === "Active" &&
        e.joinedAt.toISOString().slice(0, 10) <= shift.day.toISODate()! &&
        e.schedule.workingDays.includes(shift.day.weekday) &&
        !holidays.some((h) => h.date === shift.day.toISODate()) &&
        !activeLeave.some((onLeave) => onLeave.id === e.id)
      );
    });
    const absent = expected.filter((e) => {
      const shift = currentShift(now.toJSDate(), e.schedule);
      return (
        now > shift.start.plus({ minutes: e.schedule.graceMinutes }) &&
        !sessions.some(
          (session) =>
            session.employeeId === e.id &&
            session.clockIn <= shift.end.toJSDate() &&
            (!session.clockOut || session.clockOut >= shift.start.toJSDate()),
        )
      );
    }).length;
    const trend = await Promise.all(
      Array.from({ length: 7 }, async (_, i) => {
        const day = now.minus({ days: 6 - i });
        const items = await this.db.attendance.findMany({
          where: {
            employeeId: { in: ids },
            clockIn: {
              gte: day.startOf("day").toJSDate(),
              lte: day.endOf("day").toJSDate(),
            },
          },
        });
        return {
          day: day.toFormat("ccc"),
          date: day.toISODate(),
          present: new Set(items.map((s) => s.employeeId)).size,
          late: new Set(
            items.filter((s) => s.status === "Late").map((s) => s.employeeId),
          ).size,
        };
      }),
    );
    const monthly = FINANCE.includes(actor.role)
      ? await this.db.payroll.aggregate({
          where: {
            period: now.toFormat("yyyy-MM"),
            status: { in: ["Approved", "Paid"] },
          },
          _sum: { netMinor: true },
        })
      : null;
    return {
      timezone: zone,
      date,
      metrics: {
        total: employees.length,
        active: employees.filter((e) => e.status === "Active").length,
        clockedIn: new Set(
          sessions.filter((s) => !s.clockOut).map((s) => s.employeeId),
        ).size,
        absent,
        expected: expected.length,
        late: new Set(
          sessions.filter((s) => s.status === "Late").map((s) => s.employeeId),
        ).size,
        completed: new Set(
          sessions.filter((s) => s.clockOut).map((s) => s.employeeId),
        ).size,
        incomplete: sessions.filter(
          (s) => !s.clockOut && Date.now() - s.clockIn.getTime() > 24 * 3600000,
        ).length,
        outstandingTasks: await this.db.task.count({
          where: { employeeId: { in: ids }, status: { not: "Completed" } },
        }),
        onLeave: activeLeave.length,
        pendingLeave: pending,
        openJobs: ADMIN.includes(actor.role)
          ? await this.db.job.count({ where: { status: "Open" } })
          : null,
        payrollMinor: monthly ? String(monthly._sum.netMinor || 0n) : null,
      },
      trend,
      departments: departments
        .filter((d) => d._count.employees > 0)
        .map((d) => ({ name: d.name, value: d._count.employees })),
      atWork: sessions.filter((s) => !s.clockOut).slice(0, 5),
      recentHires: employees
        .sort((a, b) => b.joinedAt.getTime() - a.joinedAt.getTime())
        .slice(0, 4),
      announcements,
      tasks,
      activity,
    };
  }
  @Get("reports/attendance")
  async report(
    @Req() req: AuthRequest,
    @Query("from") from: string,
    @Query("to") to: string,
    @Res() res: Response,
  ) {
    permit(req.actor, PEOPLE);
    const zone = req.actor.organization!.timezone;
    const start = DateTime.fromISO(from || "", { zone }).startOf("day"),
      end = DateTime.fromISO(to || "", { zone }).endOf("day");
    if (
      !start.isValid ||
      !end.isValid ||
      end < start ||
      end.diff(start, "days").days > 93
    )
      throw new BadRequestException("Choose a report range of up to 93 days");
    const records = await this.db.attendance.findMany({
      where: {
        clockIn: { gte: start.toJSDate(), lte: end.toJSDate() },
        ...(req.actor.role === "MANAGER"
          ? {
              employee: {
                OR: [
                  { managerId: ownEmployee(req.actor) },
                  { id: ownEmployee(req.actor) },
                ],
              },
            }
          : {}),
      },
      include: { employee: { include: { department: true } } },
      orderBy: { clockIn: "asc" },
      take: 10001,
    });
    if (records.length > 10000)
      throw new BadRequestException(
        "Choose a shorter range (maximum 10,000 rows)",
      );
    const cell = (value: string) =>
      `"${(/^\s*[=+@-]|^[\t\r]/.test(value) ? "'" : "") + value.replace(/"/g, '""')}"`;
    const rows = records.map((r) =>
      [
        String(r.employee.number),
        `${r.employee.firstName} ${r.employee.lastName}`,
        r.employee.department.name,
        r.clockIn.toISOString(),
        r.clockOut?.toISOString() || "",
        r.clockOut ? String(workedMinutes(r.clockIn, r.clockOut)) : "",
        r.status,
      ]
        .map(cell)
        .join(","),
    );
    await this.db.audit.create({
      data: {
        actorId: req.actor.id,
        action: "report.attendance_exported",
        entityId: req.actor.id,
        details: { from, to, rows: records.length },
      },
    });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="flurryhr-attendance.csv"',
    );
    res.send(
      [
        "Employee ID,Employee,Department,Clock in (UTC),Clock out (UTC),Recorded minutes,Status",
        ...rows,
      ].join("\r\n"),
    );
  }
}
