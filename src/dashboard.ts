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
import { once } from "node:events";
import { DateTime } from "luxon";
import { Db } from "./db";
import { AttendanceCalculation } from "./attendance-calculation";
import { AuthGuard, AuthRequest, ownEmployee, permit } from "./auth";
import { ADMIN, PEOPLE, FINANCE } from "./domain";
import { Prisma } from "@prisma/client";
@Controller()
@UseGuards(AuthGuard)
export class DashboardController {
  constructor(
    @Inject(Db) private db: Db,
    @Inject(AttendanceCalculation) private calculation: AttendanceCalculation,
  ) {}
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
    const [employeeTotal, employeeActive, recentHires] = await Promise.all([
      this.db.employee.count({ where: scope }),
      this.db.employee.count({ where: { AND: [scope, { status: "Active" }] } }),
      this.db.employee.findMany({
        where: scope,
        include: { department: true },
        orderBy: [{ joinedAt: "desc" }, { id: "asc" }],
        take: 4,
      }),
    ]);
    const [sessions, pending, departments, announcements, tasks, activity] =
      await Promise.all([
        this.db.attendance.findMany({
          where: {
            employee: scope,
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
        this.db.leaveRequest.count({
          where: { employee: scope, status: "Pending" },
        }),
        this.db.department.findMany({
          include: { _count: { select: { employees: { where: scope } } } },
        }),
        this.db.announcement.findMany({
          orderBy: { createdAt: "desc" },
          take: 3,
        }),
        this.db.task.findMany({
          where: { employee: scope, status: { not: "Completed" } },
          orderBy: { dueDate: "asc" },
          take: 4,
        }),
        this.db.audit.findMany({
          where: ADMIN.includes(actor.role) ? {} : { actorId: actor.id },
          orderBy: { createdAt: "desc" },
          take: 5,
        }),
      ]);
    const attendanceCounts = await this.calculation.counts(
      actor,
      date,
      new Date(),
      true,
    );
    const trend = await this.calculation.trend(
      actor,
      Array.from({ length: 7 }, (_, i) =>
        now.minus({ days: 6 - i }).toISODate()!,
      ),
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
        total: employeeTotal,
        active: employeeActive,
        clockedIn: attendanceCounts.clockedIn,
        absent: attendanceCounts.absent,
        expected: attendanceCounts.expected,
        late: attendanceCounts.late,
        completed: attendanceCounts.completed,
        incomplete: attendanceCounts.incomplete,
        outstandingTasks: await this.db.task.count({
          where: { employee: scope, status: { not: "Completed" } },
        }),
        onLeave: attendanceCounts.onLeave,
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
      recentHires,
      announcements,
      tasks,
      activity,
    };
  }
  @Get("reports/attendance")
  async report(
    @Req() req: AuthRequest,
    @Query() q: Record<string, string>,
    @Res() res: Response,
  ) {
    permit(req.actor, PEOPLE);
    const { from, to } = q;
    if (typeof from !== "string" || typeof to !== "string")
      throw new BadRequestException("Choose a report range of up to 93 days");
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
    if (
      q.status &&
      ![
        "Incomplete Session",
        "Late",
        "Present",
        "On Leave",
        "Holiday",
        "Rest Day",
        "Absent",
        "Not started",
      ].includes(q.status)
    )
      throw new BadRequestException("Unknown attendance status");
    const cell = (value: string) =>
      `"${(/^\s*[=+@-]|^[\t\r]/.test(value) ? "'" : "") + value.replace(/"/g, '""')}"`;
    await this.db.audit.create({
      data: {
        actorId: req.actor.id,
        action: "report.attendance_export_started",
        entityId: req.actor.id,
        details: { from, to },
      },
    });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="flurryhr-attendance.csv"',
    );
    res.write(
      "Work date,Employee ID,Employee,Department,Clock in (UTC),Clock out (UTC),Recorded minutes,Status,Timezone\r\n",
    );
    let rows = 0;
    for (let day = start; day <= end; day = day.plus({ days: 1 })) {
      let page = 1;
      let after: string | null = null;
      do {
        if (res.destroyed) return;
        const result = await this.calculation.page(req.actor, {
          ...q,
          date: day.toISODate()!,
          page: String(page),
          limit: "100",
          after: after || "",
        });
        after = result.nextCursor;
        for (const row of result.items) {
          const line =
            [
              row.workDate,
              row.employee.id,
              `${row.employee.firstName} ${row.employee.lastName}`,
              row.employee.department,
              row.clockIn || "",
              row.clockOut || "",
              String(row.recordedMinutes),
              row.status,
              row.timezone,
            ]
              .map(cell)
              .join(",") + "\r\n";
          if (!res.write(line)) await once(res, "drain");
          rows++;
        }
        page++;
      } while (after);
    }
    await this.db.audit.create({
      data: {
        actorId: req.actor.id,
        action: "report.attendance_exported",
        entityId: req.actor.id,
        details: { from, to, rows },
      },
    });
    res.end();
  }
}
