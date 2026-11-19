import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  Req,
  Inject,
  UseGuards,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { DateTime } from "luxon";
import { Db } from "./db";
import {
  AuthGuard,
  AuthRequest,
  ownEmployee,
  permit,
  companyId,
  digest,
} from "./auth";
import {
  PEOPLE,
  ADMIN,
  arrivalStatus,
  currentShift,
  dayAttendanceStatus,
  shiftWindow,
} from "./domain";
import { notifyEmployee, notifyReviewers } from "./notifications";
import { CorrectionDto, DecisionDto } from "./dto";
@Controller("attendance")
@UseGuards(AuthGuard)
export class AttendanceController {
  constructor(@Inject(Db) private db: Db) {}
  @Get("mine")
  async mine(@Req() req: AuthRequest) {
    const employeeId = ownEmployee(req.actor);
    const [active, history] = await Promise.all([
      this.db.attendance.findFirst({ where: { employeeId, clockOut: null } }),
      this.db.attendance.findMany({
        where: { employeeId },
        orderBy: { clockIn: "desc" },
        take: 30,
        include: { corrections: true },
      }),
    ]);
    return { active, history, serverTime: new Date().toISOString() };
  }
  @Post("clock-in")
  async clockIn(@Req() req: AuthRequest) {
    const employeeId = ownEmployee(req.actor);
    const key = req.header("Idempotency-Key");
    if (key && !/^[A-Za-z0-9_-]{16,100}$/.test(key))
      throw new BadRequestException("Invalid idempotency key");
    const requestKey = key ? digest(employeeId + "|" + key) : null;
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Employee" WHERE id = ${employeeId} AND "organizationId" = ${companyId(req.actor)} FOR UPDATE`;
      if (requestKey) {
        const replay = await tx.attendance.findFirst({
          where: { employeeId, requestKey },
        });
        if (replay) return replay;
      }
      const active = await tx.attendance.findFirst({
        where: { employeeId, clockOut: null },
      });
      if (active) return active; // Repeated and concurrent requests return the same active session.
      const employee = await tx.employee.findUniqueOrThrow({
        where: { id: employeeId },
        include: { schedule: true },
      });
      if (employee.status !== "Active")
        throw new ForbiddenException("Your employee record is inactive");
      const now = new Date();
      const shift = currentShift(now, employee.schedule),
        date = shift.day.toISODate()!;
      if (employee.joinedAt.toISOString().slice(0, 10) > date)
        throw new BadRequestException(
          "Your employment start date has not been reached for this shift",
        );
      const leave = await tx.leaveRequest.findFirst({
        where: {
          employeeId,
          status: "Approved",
          startDate: { lte: date },
          endDate: { gte: date },
        },
      });
      if (leave)
        throw new BadRequestException(
          "You have approved leave for this shift. Ask HR to reverse it before clocking in.",
        );
      const holiday = await tx.holiday.findFirst({ where: { date } });
      const status = holiday
        ? "Holiday"
        : !employee.schedule.workingDays.includes(shift.day.weekday)
          ? "Rest Day"
          : arrivalStatus(now, employee.schedule);
      const session = await tx.attendance.create({
        data: {
          employeeId,
          requestKey,
          clockIn: now,
          status,
        },
      });
      await tx.audit.create({
        data: {
          actorId: req.actor.id,
          action: "attendance.clock_in",
          entityId: session.id,
        },
      });
      return session;
    });
  }
  @Post("clock-out/:id")
  async clockOut(@Req() req: AuthRequest, @Param("id") id: string) {
    const employeeId = ownEmployee(req.actor);
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Employee" WHERE id = ${employeeId} AND "organizationId" = ${companyId(req.actor)} FOR UPDATE`;
      const session = await tx.attendance.findFirst({
        where: { id, employeeId },
      });
      if (!session)
        throw new BadRequestException("No matching attendance session");
      if (session.clockOut) return session;
      const updated = await tx.attendance.update({
        where: { id },
        data: { clockOut: new Date() },
      });
      await tx.audit.create({
        data: {
          actorId: req.actor.id,
          action: "attendance.clock_out",
          entityId: id,
        },
      });
      return updated;
    });
  }
  @Get("summary")
  async summary(@Req() req: AuthRequest, @Query() q: Record<string, string>) {
    permit(req.actor, PEOPLE);
    const date =
      q.date ||
      DateTime.now().setZone(req.actor.organization!.timezone).toISODate()!;
    if (!DateTime.fromISO(date).isValid)
      throw new BadRequestException("Choose a valid date");
    const employees = await this.db.employee.findMany({
      where: {
        status: "Active",
        joinedAt: { lte: new Date(date + "T23:59:59Z") },
        ...(q.department ? { departmentId: q.department } : {}),
        ...(q.employee ? { id: q.employee } : {}),
        ...(req.actor.role === "MANAGER"
          ? {
              OR: [
                { managerId: ownEmployee(req.actor) },
                { id: ownEmployee(req.actor) },
              ],
            }
          : {}),
      },
      include: { schedule: true, department: true },
      orderBy: { firstName: "asc" },
      take: 10000,
    });
    const ids = employees.map((e) => e.id);
    const [records, leaves, holiday] = await Promise.all([
      this.db.attendance.findMany({
        where: {
          employeeId: { in: ids },
          clockIn: {
            gte: DateTime.fromISO(date, { zone: "UTC" })
              .minus({ days: 1 })
              .toJSDate(),
            lte: DateTime.fromISO(date, { zone: "UTC" })
              .plus({ days: 2 })
              .toJSDate(),
          },
        },
        orderBy: { clockIn: "asc" },
      }),
      this.db.leaveRequest.findMany({
        where: {
          employeeId: { in: ids },
          status: "Approved",
          startDate: { lte: date },
          endDate: { gte: date },
        },
      }),
      this.db.holiday.findFirst({ where: { date } }),
    ]);
    const byEmployee = new Map<string, typeof records>();
    for (const record of records) {
      const list = byEmployee.get(record.employeeId) || [];
      list.push(record);
      byEmployee.set(record.employeeId, list);
    }
    const rows = employees.map((employee) => {
      const shift = shiftWindow(date, employee.schedule),
        sessions = (byEmployee.get(employee.id) || []).filter(
          (s) =>
            s.clockIn >= shift.day.toJSDate() &&
            s.clockIn <= shift.end.toJSDate(),
        );
      return {
        employee: {
          id: employee.id,
          firstName: employee.firstName,
          lastName: employee.lastName,
          jobTitle: employee.jobTitle,
          department: employee.department.name,
        },
        status: dayAttendanceStatus(
          date,
          employee.schedule,
          sessions,
          leaves.some((l) => l.employeeId === employee.id),
          !!holiday,
        ),
        clockIn: sessions[0]?.clockIn || null,
        clockOut:
          sessions.length && sessions.every((s) => s.clockOut)
            ? sessions[sessions.length - 1].clockOut
            : null,
        recordedMinutes: sessions.reduce(
          (sum, s) =>
            sum +
            (s.clockOut
              ? Math.floor((s.clockOut.getTime() - s.clockIn.getTime()) / 60000)
              : 0),
          0,
        ),
        timezone: employee.schedule.timezone,
      };
    });
    const filtered = q.status
        ? rows.filter((row) => row.status === q.status)
        : rows,
      page = Math.max(1, Math.floor(Number(q.page) || 1)),
      limit = 20;
    return {
      items: filtered.slice((page - 1) * limit, page * limit),
      total: filtered.length,
      page,
      limit,
    };
  }
  @Get()
  async list(@Req() req: AuthRequest, @Query() q: Record<string, string>) {
    permit(req.actor, PEOPLE);
    const employeeWhere: Prisma.EmployeeWhereInput = {
      ...(req.actor.role === "MANAGER"
        ? {
            OR: [
              { managerId: ownEmployee(req.actor) },
              { id: ownEmployee(req.actor) },
            ],
          }
        : {}),
      ...(q.department ? { departmentId: q.department } : {}),
    };
    const zone = req.actor.organization!.timezone;
    const day = q.date
      ? DateTime.fromISO(q.date, { zone })
      : DateTime.now().setZone(zone);
    if (!day.isValid) throw new BadRequestException("Invalid date");
    const start = day.startOf("day").toJSDate(),
      end = day.endOf("day").toJSDate();
    const page = Math.max(1, Number(q.page) || 1),
      limit = 20;
    const where: Prisma.AttendanceWhereInput = {
      employee: employeeWhere,
      ...(q.employee ? { employeeId: q.employee } : {}),
      ...(q.status ? { status: q.status } : {}),
      clockIn: { lte: end },
      OR: [{ clockOut: { gte: start } }, { clockOut: null }],
    };
    const [items, total] = await Promise.all([
      this.db.attendance.findMany({
        where,
        include: {
          employee: { include: { department: true } },
          corrections: true,
        },
        orderBy: { clockIn: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.db.attendance.count({ where }),
    ]);
    return { items, total, page, limit };
  }
  @Get("corrections")
  corrections(@Req() req: AuthRequest) {
    return this.db.correction.findMany({
      where: {
        attendance: {
          employee: ADMIN.includes(req.actor.role)
            ? {}
            : req.actor.role === "MANAGER"
              ? {
                  OR: [
                    { managerId: ownEmployee(req.actor) },
                    { id: ownEmployee(req.actor) },
                  ],
                }
              : { id: ownEmployee(req.actor) },
        },
      },
      include: {
        attendance: {
          include: {
            employee: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                managerId: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }
  @Post("corrections")
  async correction(@Req() req: AuthRequest, @Body() dto: CorrectionDto) {
    const requestedIn = new Date(dto.requestedIn),
      requestedOut = new Date(dto.requestedOut);
    if (requestedOut <= requestedIn || requestedOut > new Date())
      throw new BadRequestException(
        "Use past timestamps with clock-out after clock-in",
      );
    return this.db.$transaction(async (tx) => {
      const item = await tx.attendance.findFirst({
        where: { id: dto.attendanceId, employeeId: ownEmployee(req.actor) },
      });
      if (!item) throw new NotFoundException("Attendance record not found");
      if (
        await tx.correction.findFirst({
          where: { attendanceId: item.id, status: "Pending" },
        })
      )
        throw new BadRequestException("A correction is already pending");
      const result = await tx.correction.create({
        data: {
          attendanceId: item.id,
          requestedIn,
          requestedOut,
          originalIn: item.clockIn,
          originalOut: item.clockOut,
          reason: dto.reason,
        },
      });
      await tx.audit.create({
        data: {
          actorId: req.actor.id,
          action: "attendance.correction_requested",
          entityId: result.id,
        },
      });
      await notifyReviewers(
        tx,
        companyId(req.actor),
        item.employeeId,
        "Attendance correction awaiting review",
        "An attendance correction needs your review.",
      );
      return result;
    });
  }
  @Patch("corrections/:id")
  async decision(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() dto: DecisionDto,
  ) {
    permit(req.actor, PEOPLE);
    return this.db.$transaction(async (tx) => {
      const item = await tx.correction.findUniqueOrThrow({
        where: { id },
        include: {
          attendance: {
            include: { employee: { include: { schedule: true } } },
          },
        },
      });
      const employee = item.attendance.employee;
      if (
        employee.id === req.actor.employee?.id ||
        (!ADMIN.includes(req.actor.role) &&
          employee.managerId !== req.actor.employee?.id)
      )
        throw new ForbiddenException(
          "Another authorised reviewer must review this correction",
        );
      await tx.$queryRaw`SELECT id FROM "Employee" WHERE id = ${employee.id} AND "organizationId" = ${companyId(req.actor)} FOR UPDATE`;
      const changed = await tx.correction.updateMany({
        where: { id, status: "Pending" },
        data: { ...dto, reviewedBy: req.actor.id },
      });
      if (!changed.count)
        throw new BadRequestException("This correction was already reviewed");
      if (dto.status === "Approved") {
        const overlap = await tx.attendance.findFirst({
          where: {
            employeeId: employee.id,
            id: { not: item.attendanceId },
            clockIn: { lt: item.requestedOut },
            OR: [{ clockOut: null }, { clockOut: { gt: item.requestedIn } }],
          },
        });
        if (overlap)
          throw new BadRequestException(
            "The corrected session overlaps another session",
          );
        const current = await tx.attendance.findUniqueOrThrow({
          where: { id: item.attendanceId },
        });
        if (
          current.clockIn.getTime() !== item.originalIn.getTime() ||
          current.clockOut?.getTime() !== item.originalOut?.getTime()
        )
          throw new BadRequestException(
            "Attendance changed since this correction was requested. Submit a fresh request.",
          );
        await tx.attendance.update({
          where: { id: item.attendanceId },
          data: {
            clockIn: item.requestedIn,
            clockOut: item.requestedOut,
            status: arrivalStatus(item.requestedIn, employee.schedule),
          },
        });
      }
      await tx.audit.create({
        data: {
          actorId: req.actor.id,
          action: "attendance.correction_reviewed",
          entityId: id,
          details: {
            ...dto,
            originalIn: item.originalIn.toISOString(),
            originalOut: item.originalOut?.toISOString() || null,
            requestedIn: item.requestedIn.toISOString(),
            requestedOut: item.requestedOut.toISOString(),
          },
        },
      });
      await notifyEmployee(
        tx,
        companyId(req.actor),
        employee.id,
        "Attendance correction reviewed",
        `Your correction was ${dto.status.toLowerCase()}.`,
      );
      return { ok: true };
    });
  }
}
