import { consumeAttendanceFace } from "./biometrics";
import { paged, pagination } from "./pagination";
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
import { AttendanceCalculation } from "./attendance-calculation";
import { WorkSchedule } from "./domain";
import {
  AuthGuard,
  AuthRequest,
  ownEmployee,
  permit,
  companyId,
  digest,
} from "./auth";
import { PEOPLE, ADMIN, arrivalStatus, currentShift } from "./domain";
import { notifyEmployee, notifyReviewers } from "./notifications";
import { CorrectionDto, DecisionDto } from "./dto";
import {
  AttendancePositionDto,
  verifyPosition,
  locationValue,
} from "./work-location";
@Controller("attendance")
@UseGuards(AuthGuard)
export class AttendanceController {
  constructor(
    @Inject(Db) private db: Db,
    @Inject(AttendanceCalculation) private calculation: AttendanceCalculation,
  ) {}
  @Get("mine")
  async mine(@Req() req: AuthRequest, @Query() q: Record<string, string>) {
    const employeeId = ownEmployee(req.actor);
    const [active, result] = await Promise.all([
      this.db.attendance.findFirst({ where: { employeeId, clockOut: null } }),
      paged(
        this.db.attendance,
        { where: { employeeId }, orderBy: { clockIn: "desc" } },
        q,
      ),
    ]);
    return {
      active,
      history: result.items,
      total: result.total,
      page: result.page,
      limit: result.limit,
      nextCursor: result.nextCursor,
      serverTime: new Date().toISOString(),
      biometricRequired:
        req.actor.organization?.biometricAttendanceRequired ?? false,
      locationPolicy: {
        kind:
          req.actor.employee?.workArrangement === "Remote"
            ? "Remote"
            : "Company",
        configured: !!locationValue(
          req.actor.employee?.workArrangement === "Remote"
            ? req.actor.employee.remoteWorkLocation
            : req.actor.organization?.attendanceLocation,
        ),
        address:
          locationValue(
            req.actor.employee?.workArrangement === "Remote"
              ? req.actor.employee.remoteWorkLocation
              : req.actor.organization?.attendanceLocation,
          )?.address ?? null,
        radiusMetres: 100,
      },
    };
  }
  @Post("clock-in")
  async clockIn(
    @Req() req: AuthRequest,
    @Body() position: AttendancePositionDto,
  ) {
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
      const verification = await this.verifyLocation(
        tx,
        req.actor,
        employee,
        position,
        now,
      );
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
      const face = await consumeAttendanceFace(
        tx,
        req.actor,
        "ClockIn",
        position.faceCheckId,
      );
      const session = await tx.attendance.create({
        data: {
          employeeId,
          requestKey,
          clockIn: now,
          status,
          locationVerification: {
            clockIn: verification,
            ...(face ? { faceClockIn: face } : {}),
          },
        },
      });
      if (face)
        await tx.faceCheck.update({
          where: { id: face.checkId },
          data: { attendanceId: session.id },
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
  async clockOut(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() position: AttendancePositionDto,
  ) {
    const employeeId = ownEmployee(req.actor);
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Employee" WHERE id = ${employeeId} AND "organizationId" = ${companyId(req.actor)} FOR UPDATE`;
      const session = await tx.attendance.findFirst({
        where: { id, employeeId },
      });
      if (!session)
        throw new BadRequestException("No matching attendance session");
      if (session.clockOut) return session;
      const employee = await tx.employee.findUniqueOrThrow({
        where: { id: employeeId },
      });
      if (employee.status !== "Active")
        throw new ForbiddenException("Your employee record is inactive");
      const now = new Date();
      const verification = await this.verifyLocation(
        tx,
        req.actor,
        employee,
        position,
        now,
      );
      const face = await consumeAttendanceFace(
        tx,
        req.actor,
        "ClockOut",
        position.faceCheckId,
        id,
      );
      const updated = await tx.attendance.update({
        where: { id },
        data: {
          clockOut: now,
          locationVerification: {
            ...((session.locationVerification as Prisma.JsonObject) || {}),
            clockOut: verification,
            ...(face ? { faceClockOut: face } : {}),
          },
        },
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
  private async verifyLocation(
    tx: Prisma.TransactionClient,
    actor: AuthRequest["actor"],
    employee: { workArrangement: string; remoteWorkLocation: unknown },
    position: AttendancePositionDto,
    now: Date,
  ) {
    await tx.$queryRaw`SELECT id FROM "Organization" WHERE id=${companyId(actor)} FOR SHARE`;
    const organization = await tx.organization.findUniqueOrThrow({
      where: { id: companyId(actor) },
    });
    if (organization.status !== "Active")
      throw new ForbiddenException("Your company workspace is unavailable");
    const remote = employee.workArrangement === "Remote";
    return verifyPosition(
      position,
      remote ? employee.remoteWorkLocation : organization.attendanceLocation,
      remote ? "Remote" : "Company",
      now.getTime(),
    );
  }
  @Get("summary")
  async summary(@Req() req: AuthRequest, @Query() q: Record<string, string>) {
    permit(req.actor, PEOPLE);
    return this.calculation.page(req.actor, q);
  }

  @Get()
  async list(@Req() req: AuthRequest, @Query() q: Record<string, string>) {
    permit(req.actor, PEOPLE);
    pagination(q);
    if (
      q.date !== undefined &&
      (typeof q.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(q.date))
    )
      throw new BadRequestException("Choose a valid YYYY-MM-DD date");
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
    const where: Prisma.AttendanceWhereInput = {
      employee: employeeWhere,
      ...(q.employee ? { employeeId: q.employee } : {}),
      ...(q.status ? { status: q.status } : {}),
      clockIn: { lte: end },
      OR: [{ clockOut: { gte: start } }, { clockOut: null }],
    };
    return paged(
      this.db.attendance,
      {
        where,
        include: {
          employee: {
            omit: { remoteWorkLocation: !ADMIN.includes(req.actor.role) },
            include: { department: true },
          },
        },
        orderBy: { clockIn: "desc" },
      },
      q,
    );
  }
  @Get("corrections")
  corrections(@Req() req: AuthRequest, @Query() q: Record<string, string>) {
    return paged(
      this.db.correction,
      {
        searchFields: ["reason"],
        filterFields: ["status"],
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
      },
      q,
    );
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
            status: arrivalStatus(
              item.requestedIn,
              (item.attendance.scheduleSnapshot as unknown as WorkSchedule) ||
                employee.schedule,
            ),
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
