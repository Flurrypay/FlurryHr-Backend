import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  Body,
  Req,
  UseGuards,
  Inject,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { DateTime } from "luxon";
import { Db } from "./db";
import {
  AuthGuard,
  AuthRequest,
  Actor,
  permit,
  ownEmployee,
  companyId,
} from "./auth";
import { ADMIN, PEOPLE, FINANCE, netPay, workDays } from "./domain";
import * as D from "./dto";
import { inviteExisting } from "./company";
import { notifyEmployee, notifyReviewers, notifyUsers } from "./notifications";
import { NoteDto, CancelLeaveDto } from "./saas.dto";
const employeeInclude = {
  department: true,
  schedule: true,
  manager: { select: { id: true, firstName: true, lastName: true } },
};
export const onboardingTitles = [
  "Contract signed",
  "Personal information verified",
  "Equipment assigned",
  "Orientation completed",
];
@Controller()
@UseGuards(AuthGuard)
export class HrController {
  constructor(@Inject(Db) private db: Db) {}
  private audit(
    tx: Prisma.TransactionClient,
    actor: Actor,
    action: string,
    entityId: string,
    details?: Prisma.InputJsonValue,
  ) {
    return tx.audit.create({
      data: { actorId: actor.id, action, entityId, details },
    });
  }
  private scope(actor: Actor): Prisma.EmployeeWhereInput {
    return ADMIN.includes(actor.role)
      ? {}
      : actor.role === "MANAGER"
        ? {
            OR: [{ managerId: ownEmployee(actor) }, { id: ownEmployee(actor) }],
          }
        : { id: ownEmployee(actor) };
  }
  @Get("directory-options")
  async options(@Req() req: AuthRequest) {
    const [departments, schedules, leaveTypes, employees] = await Promise.all([
      this.db.department.findMany({ orderBy: { name: "asc" } }),
      this.db.schedule.findMany(),
      this.db.leaveType.findMany(),
      PEOPLE.includes(req.actor.role) || FINANCE.includes(req.actor.role)
        ? this.db.employee.findMany({
            where:
              req.actor.role === "FINANCE"
                ? { status: "Active" }
                : this.scope(req.actor),
            select: { id: true, firstName: true, lastName: true },
          })
        : Promise.resolve([]),
    ]);
    return { departments, schedules, leaveTypes, employees };
  }
  @Get("employees")
  async employees(@Req() req: AuthRequest, @Query() q: Record<string, string>) {
    permit(req.actor, PEOPLE);
    const page = Math.max(1, Number(q.page) || 1),
      limit = Math.min(100, Math.max(1, Number(q.limit) || 10));
    const where: Prisma.EmployeeWhereInput = {
      AND: [
        this.scope(req.actor),
        ...(q.search
          ? [
              {
                OR: ["firstName", "lastName", "email", "jobTitle"].map(
                  (key) => ({
                    [key]: {
                      contains: q.search.slice(0, 100),
                      mode: "insensitive",
                    },
                  }),
                ),
              },
            ]
          : []),
      ],
      ...(q.department ? { departmentId: q.department } : {}),
      ...(q.status ? { status: q.status } : {}),
    };
    const [items, total] = await Promise.all([
      this.db.employee.findMany({
        where,
        include: employeeInclude,
        orderBy:
          q.sort === "name"
            ? { firstName: q.direction === "desc" ? "desc" : "asc" }
            : { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.db.employee.count({ where }),
    ]);
    return { items, total, page, limit };
  }
  @Get("employees/:id")
  async employee(@Req() req: AuthRequest, @Param("id") id: string) {
    const employee = await this.db.employee.findFirst({
      where: { AND: [{ id }, this.scope(req.actor)] },
      include: {
        ...employeeInclude,
        onboarding: true,
        membership: { select: { role: true, active: true } },
      },
    });
    if (!employee) throw new NotFoundException("Employee not found");
    return employee;
  }
  @Post("employees")
  async createEmployee(@Req() req: AuthRequest, @Body() dto: D.EmployeeDto) {
    permit(req.actor, ADMIN);
    const { initialPassword, ...data } = dto;
    return this.db.$transaction(async (tx) => {
      if (
        data.managerId &&
        !(await tx.employee.findFirst({
          where: { id: data.managerId, status: "Active" },
        }))
      )
        throw new BadRequestException("Choose an active reporting manager");
      if (initialPassword)
        throw new BadRequestException(
          "Use an invitation so the employee chooses their own password",
        );
      const employee = await tx.employee.create({
        data: {
          ...data,
          email: data.email.toLowerCase(),
          joinedAt: new Date(data.joinedAt),
          onboarding: {
            create: onboardingTitles.map((title) => ({
              title,
              organizationId: companyId(req.actor),
            })),
          },
        },
        include: employeeInclude,
      });
      await this.audit(tx, req.actor, "employee.created", employee.id);
      return employee;
    });
  }
  @Patch("employees/:id")
  async editEmployee(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() dto: D.EmployeeDto,
  ) {
    permit(req.actor, ADMIN);
    return this.db.$transaction(async (tx) => {
      const existing = await tx.employee.findUniqueOrThrow({ where: { id } });
      if (dto.managerId) {
        let cursor: string | null = dto.managerId;
        const visited = new Set<string>([id]);
        while (cursor) {
          if (visited.has(cursor))
            throw new BadRequestException(
              "Reporting relationships cannot form a cycle",
            );
          visited.add(cursor);
          const parent: { managerId: string | null } | null =
            await tx.employee.findUnique({
              where: { id: cursor },
              select: { managerId: true },
            });
          cursor = parent?.managerId || null;
        }
      }
      const { initialPassword, ...data } = dto;
      if (
        existing.userId &&
        (initialPassword ||
          data.email.toLowerCase() !== existing.email.toLowerCase())
      )
        throw new BadRequestException(
          "Account identities are managed by the account holder. Use password recovery rather than changing a shared identity.",
        );
      if (!existing.userId && initialPassword)
        throw new BadRequestException(
          "Invite this employee to set up an account securely.",
        );
      const employee = await tx.employee.update({
        where: { id },
        data: {
          ...data,
          managerId: data.managerId || null,
          email: data.email.toLowerCase(),
          joinedAt: new Date(data.joinedAt),
        },
        include: employeeInclude,
      });
      await this.audit(tx, req.actor, "employee.updated", id);
      return employee;
    });
  }
  @Patch("employees/:id/status")
  async employeeStatus(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() dto: D.StatusDto,
  ) {
    permit(req.actor, ADMIN);
    if (dto.status === "Inactive" && !dto.reason)
      throw new BadRequestException("Provide an offboarding reason");
    if (
      dto.exitDate &&
      dto.exitDate.slice(0, 10) >
        DateTime.now().setZone(req.actor.organization!.timezone).toISODate()!
    )
      throw new BadRequestException(
        "Scheduled future offboarding is not supported. Choose an effective date no later than today.",
      );
    if (id === req.actor.employee?.id)
      throw new BadRequestException("You cannot deactivate your own account");
    return this.db.$transaction(async (tx) => {
      const before = await tx.employee.findUniqueOrThrow({ where: { id } });
      if (before.status === "Invited")
        throw new BadRequestException(
          "Pending employees must accept their invitation before activation or offboarding. Revoke an unused invitation instead.",
        );
      const employee = await tx.employee.update({
        where: { id },
        data: { status: dto.status },
      });
      if (employee.userId) {
        const member = await tx.membership.findFirst({
          where: {
            userId: employee.userId,
            organizationId: companyId(req.actor),
          },
        });
        if (member?.role === "OWNER")
          throw new ForbiddenException(
            "Transfer company ownership before offboarding the owner",
          );
        if (member) {
          await tx.membership.update({
            where: { id: member.id },
            data: { active: dto.status === "Active" },
          });
          await tx.session.deleteMany({ where: { membershipId: member.id } });
        }
      }
      if (
        dto.status === "Inactive" &&
        !(await tx.onboardingItem.findFirst({
          where: { employeeId: id, title: { startsWith: "Exit:" } },
        }))
      )
        await tx.onboardingItem.createMany({
          data: [
            "Exit: Recover assigned assets",
            "Exit: Complete document handover",
            "Exit: Review final payroll",
            "Exit: Confirm access revocation",
          ].map((title) => ({
            organizationId: companyId(req.actor),
            employeeId: id,
            title,
            completed: title === "Exit: Confirm access revocation",
          })),
        });
      await this.audit(tx, req.actor, "employee.status", id, {
        status: dto.status,
        reason: dto.reason || null,
        exitDate: dto.exitDate || null,
      });
      return employee;
    });
  }
  @Patch("employees/:id/role")
  async role(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() dto: D.RoleDto,
  ) {
    permit(req.actor, ["OWNER", "SUPER_ADMIN"]);
    const employee = await this.db.employee.findUniqueOrThrow({
      where: { id },
    });
    if (!employee.userId || employee.userId === req.actor.id)
      throw new BadRequestException("Choose another employee with an account");
    return this.db.$transaction(async (tx) => {
      const member = await tx.membership.findFirst({
        where: {
          userId: employee.userId!,
          organizationId: companyId(req.actor),
        },
      });
      if (!member || member.role === "OWNER")
        throw new ForbiddenException("This membership cannot be changed");
      await tx.membership.update({
        where: { id: member.id },
        data: { role: dto.role },
      });
      await tx.session.deleteMany({ where: { membershipId: member.id } });
      await this.audit(tx, req.actor, "user.role", id, { role: dto.role });
      return { ok: true };
    });
  }
  @Get("departments")
  departments() {
    return this.db.department.findMany({
      include: { _count: { select: { employees: true } } },
      orderBy: { name: "asc" },
    });
  }
  @Post("departments")
  async department(@Req() req: AuthRequest, @Body() dto: D.NameDto) {
    permit(req.actor, ADMIN);
    return this.db.$transaction(async (tx) => {
      const item = await tx.department.create({ data: dto });
      await this.audit(tx, req.actor, "department.created", item.id);
      return item;
    });
  }
  @Post("schedules")
  async schedule(@Req() req: AuthRequest, @Body() dto: D.ScheduleDto) {
    permit(req.actor, ADMIN);
    if (
      !DateTime.now().setZone(dto.timezone).isValid ||
      dto.startMinute === dto.endMinute
    )
      throw new BadRequestException("Choose a valid timezone and shift");
    return this.db.$transaction(async (tx) => {
      const item = await tx.schedule.create({ data: dto });
      await this.audit(tx, req.actor, "schedule.created", item.id);
      return item;
    });
  }
  @Post("leave-types")
  leaveType(@Req() req: AuthRequest, @Body() dto: D.NameDto) {
    permit(req.actor, ADMIN);
    return this.db.$transaction(async (tx) => {
      const type = await tx.leaveType.create({ data: dto });
      await this.audit(tx, req.actor, "leave_type.created", type.id);
      return type;
    });
  }
  @Get("leave")
  async leave(@Req() req: AuthRequest) {
    const scope = this.scope(req.actor);
    const [requests, allocations] = await Promise.all([
      this.db.leaveRequest.findMany({
        where: { employee: scope },
        include: {
          employee: { select: { id: true, firstName: true, lastName: true } },
          leaveType: true,
        },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
      this.db.leaveAllocation.findMany({
        where: {
          employeeId: ownEmployee(req.actor),
          year: DateTime.now().setZone(req.actor.organization!.timezone).year,
        },
        include: { leaveType: true },
      }),
    ]);
    const balances = await Promise.all(
      allocations.map(async (a) => {
        const used = await this.db.leaveRequest.aggregate({
          where: {
            employeeId: a.employeeId,
            leaveTypeId: a.leaveTypeId,
            startDate: { startsWith: String(a.year) },
            status: { in: ["Pending", "Approved"] },
          },
          _sum: { days: true },
        });
        return { ...a, remaining: a.days - (used._sum.days || 0) };
      }),
    );
    return { requests, balances };
  }
  @Post("leave/allocations")
  async allocate(@Req() req: AuthRequest, @Body() dto: D.AllocationDto) {
    permit(req.actor, ADMIN);
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Employee" WHERE id = ${dto.employeeId} AND "organizationId" = ${companyId(req.actor)} FOR UPDATE`;
      const used = await tx.leaveRequest.aggregate({
        where: {
          employeeId: dto.employeeId,
          leaveTypeId: dto.leaveTypeId,
          startDate: { startsWith: String(dto.year) },
          status: { in: ["Pending", "Approved"] },
        },
        _sum: { days: true },
      });
      if (dto.days < (used._sum.days || 0))
        throw new BadRequestException(
          "Allocation cannot be less than reserved leave",
        );
      const item = await tx.leaveAllocation.upsert({
        where: {
          employeeId_leaveTypeId_year: {
            employeeId: dto.employeeId,
            leaveTypeId: dto.leaveTypeId,
            year: dto.year,
          },
        },
        update: { days: dto.days },
        create: dto,
      });
      await this.audit(tx, req.actor, "leave.allocated", item.id, {
        days: dto.days,
      });
      return item;
    });
  }
  @Post("leave")
  async requestLeave(@Req() req: AuthRequest, @Body() dto: D.LeaveDto) {
    const employeeId = ownEmployee(req.actor);
    if (dto.startDate.slice(0, 4) !== dto.endDate.slice(0, 4))
      throw new BadRequestException(
        "Split leave across calendar years into separate requests",
      );
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Employee" WHERE id = ${employeeId} AND "organizationId" = ${companyId(req.actor)} FOR UPDATE`;
      const employee = await tx.employee.findUniqueOrThrow({
        where: { id: employeeId },
        include: { schedule: true },
      });
      if (dto.startDate < employee.joinedAt.toISOString().slice(0, 10))
        throw new BadRequestException(
          "Leave cannot start before your employment start date",
        );
      const holidays = await tx.holiday.findMany({
        where: { date: { gte: dto.startDate, lte: dto.endDate } },
      });
      let days: number;
      try {
        days = workDays(
          dto.startDate,
          dto.endDate,
          employee.schedule.workingDays,
          holidays.map((h) => h.date),
        );
      } catch {
        throw new BadRequestException(
          "Choose a valid date range of up to one year",
        );
      }
      if (!days)
        throw new BadRequestException(
          "Your selection has no scheduled working days",
        );
      const overlap = await tx.leaveRequest.findFirst({
        where: {
          employeeId,
          status: { in: ["Pending", "Approved"] },
          startDate: { lte: dto.endDate },
          endDate: { gte: dto.startDate },
        },
      });
      if (overlap)
        throw new BadRequestException("This request overlaps existing leave");
      const year = Number(dto.startDate.slice(0, 4));
      const allocation = await tx.leaveAllocation.findUnique({
        where: {
          employeeId_leaveTypeId_year: {
            employeeId,
            leaveTypeId: dto.leaveTypeId,
            year,
          },
        },
      });
      const used = await tx.leaveRequest.aggregate({
        where: {
          employeeId,
          leaveTypeId: dto.leaveTypeId,
          status: { in: ["Pending", "Approved"] },
          startDate: { startsWith: String(year) },
        },
        _sum: { days: true },
      });
      if (!allocation || allocation.days - (used._sum.days || 0) < days)
        throw new BadRequestException(
          "Insufficient allocated leave. Contact HR to review your balance.",
        );
      const leave = await tx.leaveRequest.create({
        data: { ...dto, employeeId, days },
      });
      await this.audit(tx, req.actor, "leave.requested", leave.id);
      await notifyReviewers(
        tx,
        companyId(req.actor),
        employeeId,
        "Leave request awaiting review",
        "A team member submitted a leave request. Open Leave Management to review.",
      );
      return leave;
    });
  }
  @Patch("leave/:id/decision")
  async decide(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() dto: D.DecisionDto,
  ) {
    permit(req.actor, PEOPLE);
    return this.db.$transaction(async (tx) => {
      const item = await tx.leaveRequest.findUniqueOrThrow({
        where: { id },
        include: { employee: true },
      });
      if (item.employeeId === req.actor.employee?.id)
        throw new ForbiddenException("You cannot approve your own leave");
      if (
        !ADMIN.includes(req.actor.role) &&
        item.employee.managerId !== req.actor.employee?.id
      )
        throw new ForbiddenException("This employee is outside your team");
      const result = await tx.leaveRequest.updateMany({
        where: { id, status: "Pending" },
        data: { ...dto, reviewedBy: req.actor.id },
      });
      if (!result.count)
        throw new BadRequestException("Only pending requests can be reviewed");
      await this.audit(tx, req.actor, "leave.reviewed", id, { ...dto });
      await notifyEmployee(
        tx,
        companyId(req.actor),
        item.employeeId,
        "Leave request reviewed",
        `Your leave request was ${dto.status.toLowerCase()}. Sign in to view the review comments.`,
      );
      return { ok: true };
    });
  }
  @Patch("leave/:id/cancel")
  async cancel(@Req() req: AuthRequest, @Param("id") id: string) {
    return this.db.$transaction(async (tx) => {
      const result = await tx.leaveRequest.updateMany({
        where: { id, employeeId: ownEmployee(req.actor), status: "Pending" },
        data: { status: "Cancelled" },
      });
      if (!result.count)
        throw new BadRequestException(
          "Only your pending requests can be cancelled",
        );
      await this.audit(tx, req.actor, "leave.cancelled", id);
      return { ok: true };
    });
  }
  @Get("announcements")
  announcements() {
    return this.db.announcement.findMany({
      orderBy: { createdAt: "desc" },
      take: 30,
    });
  }
  @Post("announcements")
  async announce(@Req() req: AuthRequest, @Body() dto: D.AnnouncementDto) {
    permit(req.actor, ADMIN);
    return this.db.$transaction(async (tx) => {
      const item = await tx.announcement.create({ data: dto });
      await this.audit(tx, req.actor, "announcement.created", item.id);
      const members = await tx.membership.findMany({
        where: { organizationId: companyId(req.actor), active: true },
      });
      await notifyUsers(
        tx,
        companyId(req.actor),
        members.map((m) => m.userId),
        "New company announcement",
        "A company update is available in your workspace.",
      );
      return item;
    });
  }
  @Get("recruitment")
  async recruitment(@Req() req: AuthRequest) {
    permit(req.actor, ADMIN);
    return this.db.job.findMany({
      include: { candidates: { orderBy: { createdAt: "desc" } } },
      orderBy: { createdAt: "desc" },
    });
  }
  @Post("jobs")
  job(@Req() req: AuthRequest, @Body() dto: D.JobDto) {
    permit(req.actor, ADMIN);
    return this.db.$transaction(async (tx) => {
      const job = await tx.job.create({ data: dto });
      await this.audit(tx, req.actor, "job.created", job.id);
      return job;
    });
  }
  @Post("candidates")
  candidate(@Req() req: AuthRequest, @Body() dto: D.CandidateDto) {
    permit(req.actor, ADMIN);
    return this.db.candidate.create({
      data: { ...dto, email: dto.email.toLowerCase() },
    });
  }
  @Patch("candidates/:id/stage")
  async stage(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() dto: D.StageDto,
  ) {
    permit(req.actor, ADMIN);
    if (dto.stage === "Hired")
      throw new BadRequestException(
        "Use Convert to employee after recording an accepted offer",
      );
    return this.db.$transaction(async (tx) => {
      const item = await tx.candidate.findUniqueOrThrow({ where: { id } });
      if (item.employeeId)
        throw new BadRequestException("Candidate has already been hired");
      if (dto.offerAccepted && dto.stage !== "Offer")
        throw new BadRequestException("Acceptance requires the Offer stage");
      const updated = await tx.candidate.update({
        where: { id },
        data: {
          stage: dto.stage,
          offerAccepted:
            dto.stage === "Offer" ? (dto.offerAccepted ?? false) : false,
        },
      });
      await this.audit(tx, req.actor, "candidate.stage", id, {
        stage: dto.stage,
      });
      return updated;
    });
  }
  @Post("candidates/:id/convert")
  async convert(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() dto: D.ConvertDto,
  ) {
    permit(req.actor, ADMIN);
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Candidate" WHERE id = ${id} AND "organizationId" = ${companyId(req.actor)} FOR UPDATE`;
      const candidate = await tx.candidate.findUniqueOrThrow({
        where: { id },
        include: { job: true },
      });
      if (
        candidate.employeeId ||
        candidate.stage !== "Offer" ||
        !candidate.offerAccepted
      )
        throw new BadRequestException(
          "Conversion requires an accepted offer that has not been converted",
        );
      const names = candidate.name.trim().split(/\s+/);
      const employee = await tx.employee.create({
        data: {
          firstName: names.shift()!,
          lastName: names.join(" ") || "—",
          email: candidate.email,
          jobTitle: candidate.job.title,
          departmentId: dto.departmentId,
          scheduleId: dto.scheduleId,
          joinedAt: new Date(dto.joinedAt),
          status: "Invited",
          workArrangement: candidate.job.workArrangement,
          onboarding: {
            create: onboardingTitles.map((title) => ({
              title,
              organizationId: companyId(req.actor),
            })),
          },
        },
      });
      await tx.candidate.update({
        where: { id },
        data: { stage: "Hired", employeeId: employee.id },
      });
      await inviteExisting(
        tx,
        companyId(req.actor),
        employee.id,
        employee.email,
        "EMPLOYEE",
        req.actor.id,
      );
      await this.audit(tx, req.actor, "candidate.converted", id, {
        employeeId: employee.id,
      });
      return employee;
    });
  }
  @Get("onboarding")
  onboarding(@Req() req: AuthRequest) {
    return this.db.employee.findMany({
      where: { AND: [this.scope(req.actor), { onboarding: { some: {} } }] },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        jobTitle: true,
        status: true,
        department: true,
        onboarding: true,
      },
      take: 100,
    });
  }
  @Patch("onboarding/:id")
  async onboard(@Req() req: AuthRequest, @Param("id") id: string) {
    return this.db.$transaction(async (tx) => {
      const item = await tx.onboardingItem.findUniqueOrThrow({ where: { id } });
      if (
        !ADMIN.includes(req.actor.role) &&
        !(
          item.employeeId === req.actor.employee?.id &&
          [
            "Confirm your profile",
            "Review employment details",
            "Review company policies",
          ].includes(item.title)
        )
      )
        throw new ForbiddenException("HR must complete this checklist item");
      if (item.title === "Exit: Confirm access revocation")
        throw new BadRequestException(
          "Access revocation is recorded automatically",
        );
      if (
        item.title === "Exit: Recover assigned assets" &&
        !item.completed &&
        (await tx.asset.count({ where: { employeeId: item.employeeId } }))
      )
        throw new BadRequestException(
          "Record all asset returns before completing recovery",
        );
      const result = await tx.onboardingItem.update({
        where: { id },
        data: { completed: !item.completed },
      });
      await this.audit(tx, req.actor, "onboarding.updated", id, {
        completed: result.completed,
      });
      return result;
    });
  }
  @Get("tasks")
  tasks(@Req() req: AuthRequest) {
    return this.db.task.findMany({
      where: { employee: this.scope(req.actor) },
      include: { employee: { select: { firstName: true, lastName: true } } },
      orderBy: { dueDate: "asc" },
      take: 100,
    });
  }
  @Post("tasks")
  async createTask(@Req() req: AuthRequest, @Body() dto: D.TaskDto) {
    permit(req.actor, PEOPLE);
    if (
      !(await this.db.employee.findFirst({
        where: { AND: [{ id: dto.employeeId }, this.scope(req.actor)] },
      }))
    )
      throw new ForbiddenException();
    return this.db.$transaction(async (tx) => {
      const task = await tx.task.create({
        data: { ...dto, dueDate: new Date(dto.dueDate) },
      });
      await tx.taskEvent.create({
        data: {
          taskId: task.id,
          actorId: req.actor.id,
          status: task.status,
          note: "Task assigned",
        },
      });
      await this.audit(tx, req.actor, "task.assigned", task.id);
      await notifyEmployee(
        tx,
        companyId(req.actor),
        dto.employeeId,
        "New task assigned",
        "A new task is ready in your workspace.",
      );
      return task;
    });
  }
  @Patch("tasks/:id")
  async taskStatus(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() dto: D.TaskStatusDto,
  ) {
    return this.db.$transaction(async (tx) => {
      const task = await tx.task.findFirst({
        where: { id, employee: this.scope(req.actor) },
      });
      if (!task) throw new NotFoundException();
      await tx.task.update({ where: { id }, data: dto });
      await tx.taskEvent.create({
        data: {
          taskId: id,
          actorId: req.actor.id,
          status: dto.status,
          note: "Status updated",
        },
      });
      await this.audit(tx, req.actor, "task.status", id, {
        status: dto.status,
      });
      if (dto.status === "Completed" && task.status !== "Completed")
        await notifyReviewers(
          tx,
          companyId(req.actor),
          task.employeeId,
          "Task completed",
          "A team member completed an assigned task.",
        );
      return { ok: true };
    });
  }
  @Get("tasks/:id/history") async taskHistory(
    @Req() req: AuthRequest,
    @Param("id") id: string,
  ) {
    if (
      !(await this.db.task.findFirst({
        where: { id, employee: this.scope(req.actor) },
      }))
    )
      throw new NotFoundException();
    return this.db.taskEvent.findMany({
      where: { taskId: id },
      orderBy: { createdAt: "asc" },
    });
  }
  @Post("tasks/:id/notes") async taskNote(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() dto: NoteDto,
  ) {
    return this.db.$transaction(async (tx) => {
      const task = await tx.task.findFirst({
        where: { id, employee: this.scope(req.actor) },
      });
      if (!task) throw new NotFoundException();
      const event = await tx.taskEvent.create({
        data: {
          taskId: id,
          actorId: req.actor.id,
          status: task.status,
          note: dto.note,
        },
      });
      await this.audit(tx, req.actor, "task.note", id);
      return event;
    });
  }
  @Patch("leave/:id/reverse") async reverseLeave(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() dto: CancelLeaveDto,
  ) {
    permit(req.actor, ADMIN);
    return this.db.$transaction(async (tx) => {
      const leave = await tx.leaveRequest.findUniqueOrThrow({ where: { id } });
      const today = DateTime.now()
        .setZone(req.actor.organization!.timezone)
        .toISODate()!;
      if (leave.startDate < today)
        throw new BadRequestException(
          "Only future approved leave can be reversed",
        );
      const updated = await tx.leaveRequest.updateMany({
        where: { id, status: "Approved" },
        data: {
          status: "Cancelled",
          comment: dto.reason,
          reviewedBy: req.actor.id,
        },
      });
      if (!updated.count)
        throw new BadRequestException("Only approved leave can be reversed");
      await this.audit(tx, req.actor, "leave.reversed", id, {
        reason: dto.reason,
      });
      await notifyEmployee(
        tx,
        companyId(req.actor),
        leave.employeeId,
        "Leave approval reversed",
        "HR reversed a future leave approval. Reserved days are available again.",
      );
      return { ok: true };
    });
  }

  @Get("payroll")
  async payroll(@Req() req: AuthRequest) {
    const items = await this.db.payroll.findMany({
      where: FINANCE.includes(req.actor.role)
        ? {}
        : {
            employeeId: ownEmployee(req.actor),
            status: { in: ["Approved", "Paid"] },
          },
      include: {
        employee: { select: { firstName: true, lastName: true, number: true } },
      },
      orderBy: { period: "desc" },
      take: 100,
    });
    return items.map((p) => ({
      ...p,
      baseMinor: p.baseMinor.toString(),
      allowancesMinor: p.allowancesMinor.toString(),
      deductionsMinor: p.deductionsMinor.toString(),
      netMinor: p.netMinor.toString(),
    }));
  }
  @Post("payroll")
  async createPayroll(@Req() req: AuthRequest, @Body() dto: D.PayrollDto) {
    permit(req.actor, FINANCE);
    let net: bigint;
    try {
      net = netPay(dto.baseMinor, dto.allowancesMinor, dto.deductionsMinor);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    return this.db.$transaction(async (tx) => {
      const item = await tx.payroll.create({
        data: {
          ...dto,
          baseMinor: BigInt(dto.baseMinor),
          allowancesMinor: BigInt(dto.allowancesMinor),
          deductionsMinor: BigInt(dto.deductionsMinor),
          netMinor: net,
          createdBy: req.actor.id,
        },
      });
      await this.audit(tx, req.actor, "payroll.created", item.id);
      return { id: item.id };
    });
  }
  @Patch("payroll/:id/approve")
  async approvePayroll(@Req() req: AuthRequest, @Param("id") id: string) {
    permit(req.actor, FINANCE);
    return this.db.$transaction(async (tx) => {
      const item = await tx.payroll.findUniqueOrThrow({ where: { id } });
      if (item.createdBy === req.actor.id)
        throw new ForbiddenException(
          "A different authorised user must approve this payroll record",
        );
      const result = await tx.payroll.updateMany({
        where: { id, status: "Draft" },
        data: { status: "Approved", approvedBy: req.actor.id },
      });
      if (!result.count)
        throw new BadRequestException("Only drafts can be approved");
      await this.audit(tx, req.actor, "payroll.approved", id);
      return { ok: true };
    });
  }
  @Get("audit")
  auditLogs(@Req() req: AuthRequest) {
    permit(req.actor, ADMIN);
    return this.db.audit.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }
}
