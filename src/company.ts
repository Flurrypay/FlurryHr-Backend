import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Req,
  Query,
  Inject,
  UseGuards,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { WorkLocationDto, locationValue } from "./work-location";
import { DateTime } from "luxon";
import { hash } from "bcryptjs";
import { Prisma } from "@prisma/client";
import { Db } from "./db";
import {
  AuthGuard,
  AuthRequest,
  permit,
  companyId,
  digest,
  newToken,
} from "./auth";
import { ADMIN } from "./domain";
import {
  CompanyDto,
  InviteDto,
  AcceptDto,
  TokenDto,
  HolidayDto,
  ProfileDto,
} from "./saas.dto";
import { pagination, paged, rawCursor, readRawCursor } from "./pagination";
import { queueMail, emailLink, mailConfigured } from "./mail";
const welcomeTasks = [
  "Confirm your profile",
  "Review employment details",
  "Review company policies",
  "Complete orientation",
];
export async function inviteExisting(
  tx: Prisma.TransactionClient,
  orgId: string,
  employeeId: string,
  email: string,
  role: "EMPLOYEE" | "MANAGER" | "HR_ADMIN" | "COMPANY_ADMIN" | "FINANCE",
  actorId: string,
  existing?: { id: string; tokenHash: string },
) {
  const org = await tx.organization.findUniqueOrThrow({ where: { id: orgId } });
  const checklist = await tx.onboardingItem.findMany({
    where: { employeeId, organizationId: orgId },
    select: { title: true },
  });
  const missing = welcomeTasks.filter(
    (title) => !checklist.some((item) => item.title === title),
  );
  if (missing.length)
    await tx.onboardingItem.createMany({
      data: missing.map((title) => ({
        organizationId: orgId,
        employeeId,
        title,
      })),
    });
  const token = newToken();
  const data = {
    organizationId: orgId,
    employeeId,
    email: email.toLowerCase(),
    role,
    tokenHash: digest(token),
    expiresAt: new Date(Date.now() + 7 * 86400000),
    invitedBy: actorId,
  };
  let invitation;
  if (existing) {
    const changed = await tx.invitation.updateMany({
      where: {
        id: existing.id,
        tokenHash: existing.tokenHash,
        status: "Pending",
      },
      data,
    });
    if (!changed.count)
      throw new BadRequestException("Invitation changed. Refresh and retry.");
    invitation = await tx.invitation.findUniqueOrThrow({
      where: { id: existing.id },
    });
  } else {
    invitation = await tx.invitation.create({ data });
  }
  await tx.mailJob.updateMany({
    where: {
      organizationId: orgId,
      to: email.toLowerCase(),
      subject: `You're invited to ${org.name} on FlurryPay HR`,
      status: { in: ["Queued", "Retry", "Failed"] },
    },
    data: { status: "Superseded", body: "[Superseded invitation]" },
  });
  await queueMail(tx, {
    referenceId: invitation.id,
    organizationId: orgId,
    to: email.toLowerCase(),
    subject: `You're invited to ${org.name} on FlurryPay HR`,
    body: `${org.name} has invited you to its FlurryPay HR workspace.\n\nAccept your invitation: ${emailLink("/accept-invitation", token)}\n\nThis single-use link expires in 7 days. If you already have an account, sign in with ${email.toLowerCase()} before accepting.`,
  });
  return invitation;
}

async function syncUnacceptedEmployee(
  tx: Prisma.TransactionClient,
  organizationId: string,
  employeeId: string,
) {
  await tx.$queryRaw`SELECT id FROM "Employee" WHERE id=${employeeId} AND "organizationId"=${organizationId} FOR UPDATE`;
  const latest = await tx.invitation.findFirst({
    where: { employeeId, organizationId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  if (!latest || !["Revoked", "Deleted"].includes(latest.status)) return;
  await tx.employee.updateMany({
    where: {
      id: employeeId,
      organizationId,
      userId: null,
      status: { in: ["Invited", "Not invited", "Removed"] },
    },
    data: { status: latest.status === "Deleted" ? "Removed" : "Not invited" },
  });
}

@Controller()
@UseGuards(AuthGuard)
export class CompanyController {
  constructor(@Inject(Db) private db: Db) {}
  @Get("mail/configuration")
  mailConfiguration(@Req() req: AuthRequest) {
    permit(req.actor, ADMIN);
    return { configured: mailConfigured() };
  }
  @Get("company") company(@Req() req: AuthRequest) {
    return req.actor.organization;
  }
  @Patch("company")
  async update(@Req() req: AuthRequest, @Body() dto: CompanyDto) {
    permit(req.actor, ["OWNER", "COMPANY_ADMIN", "SUPER_ADMIN"]);
    if (!DateTime.now().setZone(dto.timezone).isValid)
      throw new BadRequestException("Use a valid IANA timezone");
    if (dto.logo && !/^https:\/\/[^\s]+$/.test(dto.logo))
      throw new BadRequestException("Logo must be an HTTPS URL");
    const { finish, ...data } = dto;
    return this.db.system.$transaction(async (tx) => {
      const org = await tx.organization.update({
        where: { id: companyId(req.actor) },
        data: {
          ...data,
          ...(finish ? { onboardingCompleted: true, onboardingStep: 6 } : {}),
        },
      });
      await tx.audit.create({
        data: {
          organizationId: org.id,
          actorId: req.actor.id,
          action: finish ? "company.onboarded" : "company.updated",
          entityId: org.id,
        },
      });
      return org;
    });
  }
  @Patch("company/attendance-location")
  async attendanceLocation(
    @Req() req: AuthRequest,
    @Body() dto: WorkLocationDto,
  ) {
    permit(req.actor, ADMIN);
    return this.db.system.$transaction(async (tx) => {
      if (!locationValue(dto))
        throw new BadRequestException(
          "Provide a valid address and coordinates",
        );
      const location = {
        address: dto.address.trim(),
        latitude: dto.latitude,
        longitude: dto.longitude,
      };
      const org = await tx.organization.update({
        where: { id: companyId(req.actor) },
        data: { attendanceLocation: location },
      });
      await tx.audit.create({
        data: {
          organizationId: org.id,
          actorId: req.actor.id,
          action: "company.attendance_location_updated",
          entityId: org.id,
          details: { radiusMetres: 100 },
        },
      });
      return org;
    });
  }
  @Get("invitations")
  async invitations(
    @Req() req: AuthRequest,
    @Query() q: Record<string, string>,
  ) {
    permit(req.actor, ADMIN);
    const { page, limit, skip } = pagination(q),
      org = companyId(req.actor);
    const cursorScope = JSON.stringify([
      org,
      "invitations",
      q.search || "",
      q.status || "",
    ]);
    const after = readRawCursor(q.after, cursorScope, 2);
    const [result] = await this.db.system.$queryRaw<
      { items: unknown[]; total: number }[]
    >(Prisma.sql`
      WITH latest AS (
        SELECT DISTINCT ON (i."employeeId") i.id,i.email,i.role,i."employeeId",to_char(i."expiresAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "expiresAt",to_char(i."createdAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt",to_char(i."acceptedAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "acceptedAt",
          CASE WHEN i.status='Pending' AND i."expiresAt"<(now() AT TIME ZONE 'UTC') THEN 'Expired' ELSE i.status END AS status
        FROM "Invitation" i WHERE i."organizationId"=${org}
        ORDER BY i."employeeId",i."createdAt" DESC,i.id DESC
      ), filtered AS (SELECT * FROM latest WHERE status<>'Deleted'
        ${q.search ? Prisma.sql`AND email ILIKE ${"%" + q.search.slice(0, 100) + "%"}` : Prisma.empty}
        ${q.status ? Prisma.sql`AND status=${q.status}` : Prisma.empty}
      ), page AS (SELECT * FROM filtered ${after ? Prisma.sql`WHERE ("createdAt",id)<(${after[0]},${after[1]})` : Prisma.empty} ORDER BY "createdAt" DESC,id DESC LIMIT ${limit} OFFSET ${after ? 0 : skip}),
      enriched AS (SELECT p.*, (SELECT jsonb_build_object('id',m.id,'status',m.status,'lastError',m."lastError",'attempts',m.attempts,'createdAt',to_char(m."createdAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
        FROM "MailJob" m WHERE m."organizationId"=${org} AND m."referenceId"=p.id ORDER BY m."createdAt" DESC,m.id DESC LIMIT 1) AS delivery FROM page p)
      SELECT COALESCE((SELECT jsonb_agg(to_jsonb(enriched) ORDER BY "createdAt" DESC,id DESC) FROM enriched),'[]'::jsonb) AS items,
        (SELECT count(*)::int FROM filtered) AS total`);
    const last = result.items.at(-1) as
      { createdAt: string; id: string } | undefined;
    return {
      ...result,
      page,
      limit,
      nextCursor: rawCursor(cursorScope, last && [last.createdAt, last.id]),
    };
  }
  @Get("invitations/:id/history")
  async invitationHistory(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Query() q: Record<string, string>,
  ) {
    permit(req.actor, ADMIN);
    const invitation = await this.db.invitation.findUniqueOrThrow({
        where: { id, status: { not: "Deleted" } },
      }),
      org = companyId(req.actor),
      { page, limit, skip } = pagination(q);
    const cursorScope = JSON.stringify([
      org,
      "invitation-history",
      invitation.employeeId,
    ]);
    const after = readRawCursor(q.after, cursorScope, 2);
    const [result] = await this.db.system.$queryRaw<
      { items: unknown[]; total: number }[]
    >(Prisma.sql`
      WITH history AS (SELECT m.id,m.status,m.attempts,m."lastError",to_char(m."createdAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt",to_char(m."acceptedAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "acceptedAt"
        FROM "MailJob" m JOIN "Invitation" i ON i.id=m."referenceId" AND i."organizationId"=${org}
        WHERE m."organizationId"=${org} AND i."employeeId"=${invitation.employeeId}),
      page AS (SELECT * FROM history ${after ? Prisma.sql`WHERE ("createdAt",id)<(${after[0]},${after[1]})` : Prisma.empty} ORDER BY "createdAt" DESC,id DESC LIMIT ${limit} OFFSET ${after ? 0 : skip})
      SELECT COALESCE((SELECT jsonb_agg(to_jsonb(page) ORDER BY "createdAt" DESC,id DESC) FROM page),'[]'::jsonb) AS items,
        (SELECT count(*)::int FROM history) AS total`);
    const last = result.items.at(-1) as
      { createdAt: string; id: string } | undefined;
    return {
      ...result,
      page,
      limit,
      nextCursor: rawCursor(cursorScope, last && [last.createdAt, last.id]),
    };
  }
  @Post("invitations")
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async invite(@Req() req: AuthRequest, @Body() dto: InviteDto) {
    permit(req.actor, ADMIN);
    if (
      dto.workArrangement === "Remote" &&
      !locationValue(dto.remoteWorkLocation)
    )
      throw new BadRequestException(
        "Provide the approved remote work location before inviting a remote employee",
      );
    if (
      dto.role === "COMPANY_ADMIN" &&
      !["OWNER", "SUPER_ADMIN"].includes(req.actor.role)
    )
      throw new ForbiddenException(
        "Only the company owner can invite company administrators",
      );
    return this.db.$transaction(async (tx) => {
      const department = await tx.department.findUnique({
          where: { id: dto.departmentId },
        }),
        schedule = await tx.schedule.findUnique({
          where: { id: dto.scheduleId },
        });
      if (
        !department ||
        !schedule ||
        (dto.managerId &&
          !(await tx.employee.findUnique({ where: { id: dto.managerId } })))
      )
        throw new BadRequestException(
          "Choose department, manager and schedule from this company",
        );
      const { role, ...data } = dto;
      const existing = await tx.employee.findFirst({
        where: { email: data.email.toLowerCase() },
      });
      if (existing?.userId || existing?.status === "Inactive")
        throw new BadRequestException(
          "This employee already has an account or is inactive",
        );
      if (existing)
        await tx.$queryRaw`SELECT id FROM "Employee" WHERE id=${existing.id} AND "organizationId"=${companyId(req.actor)} FOR UPDATE`;
      if (
        existing &&
        (await tx.invitation.findFirst({
          where: { employeeId: existing.id, status: "Pending" },
        }))
      )
        throw new BadRequestException(
          "An invitation already exists. Resend or revoke it from Invitations.",
        );
      const employee = existing
        ? await tx.employee.update({
            where: { id: existing.id },
            data: {
              ...data,
              email: data.email.toLowerCase(),
              joinedAt: new Date(data.joinedAt),
              status: "Invited",
            },
          })
        : await tx.employee.create({
            data: {
              ...data,
              email: data.email.toLowerCase(),
              joinedAt: new Date(data.joinedAt),
              status: "Invited",
              onboarding: {
                create: welcomeTasks.map((title) => ({
                  title,
                  organizationId: companyId(req.actor),
                })),
              },
            },
          });
      const invitation = await inviteExisting(
        tx,
        companyId(req.actor),
        employee.id,
        employee.email,
        role,
        req.actor.id,
      );
      await tx.audit.create({
        data: {
          actorId: req.actor.id,
          action: "employee.invited",
          entityId: employee.id,
        },
      });
      return {
        id: invitation.id,
        employeeId: employee.id,
        message:
          "Invitation saved and email queued. Delivery status is shown in Invitations.",
      };
    });
  }
  @Post("employees/:id/invite")
  async inviteRecordedEmployee(
    @Req() req: AuthRequest,
    @Param("id") id: string,
  ) {
    permit(req.actor, ADMIN);
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Employee" WHERE id=${id} AND "organizationId"=${companyId(req.actor)} FOR UPDATE`;
      const employee = await tx.employee.findUniqueOrThrow({ where: { id } });
      if (employee.userId || employee.status === "Inactive")
        throw new BadRequestException("This employee cannot be invited");
      if (
        await tx.invitation.findFirst({
          where: { employeeId: id, status: "Pending" },
        })
      )
        throw new BadRequestException(
          "Use resend or revoke on the pending invitation",
        );
      await tx.employee.update({ where: { id }, data: { status: "Invited" } });
      const invitation = await inviteExisting(
        tx,
        companyId(req.actor),
        id,
        employee.email,
        "EMPLOYEE",
        req.actor.id,
      );
      await tx.audit.create({
        data: {
          actorId: req.actor.id,
          action: "employee.invited",
          entityId: id,
        },
      });
      return {
        id: invitation.id,
        message: "Invitation queued for the existing employee record.",
      };
    });
  }
  @Post("invitations/:id/resend")
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async resend(@Req() req: AuthRequest, @Param("id") id: string) {
    permit(req.actor, ADMIN);
    if (!mailConfigured())
      throw new ServiceUnavailableException(
        "Email service is not configured. Set ZOHO_EMAIL_API_URL, ZOHO_EMAIL_API_KEY and ZOHO_EMAIL_FROM in backend/.env, then restart the backend. The invitation has not changed.",
      );
    return this.db.$transaction(async (tx) => {
      const item = await tx.invitation.findUniqueOrThrow({ where: { id } });
      if (!["Pending", "Expired"].includes(item.status))
        throw new BadRequestException(
          "Only pending or expired invitations can be resent",
        );
      await inviteExisting(
        tx,
        companyId(req.actor),
        item.employeeId,
        item.email,
        item.role as InviteDto["role"],
        req.actor.id,
        { id: item.id, tokenHash: item.tokenHash },
      );
      await tx.audit.create({
        data: {
          actorId: req.actor.id,
          action: "invitation.resent",
          entityId: id,
        },
      });
      return {
        message: "Invitation email queued again. The previous link is invalid.",
      };
    });
  }
  @Post("invitations/:id/revoke")
  async revoke(@Req() req: AuthRequest, @Param("id") id: string) {
    permit(req.actor, ADMIN);
    return this.db.$transaction(async (tx) => {
      const invitation = await tx.invitation.findUniqueOrThrow({
        where: { id },
      });
      const item = await tx.invitation.updateMany({
        where: { id, status: "Pending" },
        data: { status: "Revoked" },
      });
      if (!item.count)
        throw new NotFoundException("Pending invitation not found");
      await tx.mailJob.updateMany({
        where: {
          organizationId: companyId(req.actor),
          referenceId: id,
          status: { in: ["Queued", "Retry", "Failed"] },
        },
        data: {
          status: "Superseded",
          body: "[Revoked invitation]",
          lastError: null,
        },
      });
      await syncUnacceptedEmployee(
        tx,
        companyId(req.actor),
        invitation.employeeId,
      );
      await tx.audit.create({
        data: {
          actorId: req.actor.id,
          action: "invitation.revoked",
          entityId: id,
        },
      });
      return { ok: true };
    });
  }
  @Delete("invitations/:id")
  async deleteInvitation(@Req() req: AuthRequest, @Param("id") id: string) {
    permit(req.actor, ADMIN);
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Invitation" WHERE id=${id} AND "organizationId"=${companyId(req.actor)} FOR UPDATE`;
      const item = await tx.invitation.findUniqueOrThrow({ where: { id } });
      if (item.status === "Deleted") {
        await syncUnacceptedEmployee(tx, companyId(req.actor), item.employeeId);
        return { ok: true };
      }
      if (item.status !== "Revoked")
        throw new BadRequestException(
          "Revoke the invitation before deleting it",
        );
      await tx.invitation.update({
        where: { id },
        data: { status: "Deleted" },
      });
      await syncUnacceptedEmployee(tx, companyId(req.actor), item.employeeId);
      await tx.audit.create({
        data: {
          actorId: req.actor.id,
          action: "invitation.deleted",
          entityId: id,
          details: { employeeId: item.employeeId, email: item.email },
        },
      });
      return { ok: true };
    });
  }
  @Get("mail")
  async mail(@Req() req: AuthRequest, @Query() q: Record<string, string>) {
    permit(req.actor, ADMIN);
    return paged(
      this.db.system.mailJob,
      {
        searchFields: ["to", "subject"],
        filterFields: ["status"],
        where: { organizationId: companyId(req.actor) },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          to: true,
          subject: true,
          status: true,
          attempts: true,
          lastError: true,
          acceptedAt: true,
          createdAt: true,
        },
      },
      q,
    );
  }
  @Post("mail/:id/retry")
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async retry(@Req() req: AuthRequest, @Param("id") id: string) {
    permit(req.actor, ADMIN);
    const result = await this.db.system.mailJob.updateMany({
      where: {
        id,
        organizationId: companyId(req.actor),
        status: { in: ["Failed", "Retry"] },
      },
      data: {
        status: "Queued",
        attempts: 0,
        availableAt: new Date(),
        lastError: null,
      },
    });
    if (!result.count)
      throw new NotFoundException("Retryable message not found");
    return { message: "Message queued for retry" };
  }
  @Get("holidays") holidays(@Query() q: Record<string, string>) {
    return paged(
      this.db.holiday,
      { searchFields: ["name"], orderBy: { date: "asc" } },
      q,
    );
  }
  @Post("holidays") holiday(@Req() req: AuthRequest, @Body() dto: HolidayDto) {
    permit(req.actor, ADMIN);
    if (!DateTime.fromISO(dto.date).isValid)
      throw new BadRequestException("Invalid date");
    return this.db.$transaction(async (tx) => {
      const holiday = await tx.holiday.create({ data: dto });
      await tx.audit.create({
        data: {
          actorId: req.actor.id,
          action: "holiday.created",
          entityId: holiday.id,
        },
      });
      return holiday;
    });
  }
  @Patch("profile") async profile(
    @Req() req: AuthRequest,
    @Body() dto: ProfileDto,
  ) {
    if (!req.actor.employee) throw new BadRequestException();
    return this.db.$transaction(async (tx) => {
      const employee = await tx.employee.update({
        where: { id: req.actor.employee!.id },
        data: { phone: dto.phone },
      });
      if (dto.emailNotifications !== undefined)
        await tx.membership.update({
          where: { id: req.actor.membership!.id },
          data: { emailNotifications: dto.emailNotifications },
        });
      await tx.audit.create({
        data: {
          actorId: req.actor.id,
          action: "profile.updated",
          entityId: employee.id,
        },
      });
      return employee;
    });
  }
  @Get("notifications") notifications(
    @Req() req: AuthRequest,
    @Query() q: Record<string, string>,
  ) {
    return paged(
      this.db.notification,
      {
        searchFields: ["title", "body"],
        where: { userId: req.actor.id },
        orderBy: { createdAt: "desc" },
      },
      q,
    );
  }
  @Patch("notifications/:id/read") async read(
    @Req() req: AuthRequest,
    @Param("id") id: string,
  ) {
    await this.db.notification.updateMany({
      where: { id, userId: req.actor.id },
      data: { readAt: new Date() },
    });
    return { ok: true };
  }
}
@Controller("invitations")
export class InvitationController {
  constructor(@Inject(Db) private db: Db) {}
  @Post("inspect")
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async inspect(@Body() dto: TokenDto) {
    const item = await this.db.system.invitation.findUnique({
      where: { tokenHash: digest(dto.token) },
      include: { organization: true },
    });
    if (
      !item ||
      item.status !== "Pending" ||
      item.expiresAt < new Date() ||
      item.organization.status !== "Active"
    )
      throw new BadRequestException(
        "This invitation is invalid, expired, revoked, or its company is unavailable",
      );
    const user = await this.db.system.user.findUnique({
      where: { email: item.email },
    });
    return {
      email: item.email,
      companyName: item.organization.name,
      existingAccount: !!user,
      expiresAt: item.expiresAt,
    };
  }
  @Post("accept")
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async accept(@Req() req: RequestWithCookie, @Body() dto: AcceptDto) {
    const cookie = req.cookies?.flurry_session;
    const session = cookie
      ? await this.db.system.session.findUnique({
          where: { id: digest(cookie) },
          include: { user: true },
        })
      : null;
    return this.db.system.$transaction(async (tx) => {
      const invitation = await tx.invitation.findUnique({
        where: { tokenHash: digest(dto.token) },
        include: { organization: true },
      });
      if (
        !invitation ||
        invitation.status !== "Pending" ||
        invitation.expiresAt < new Date() ||
        invitation.organization.status !== "Active"
      )
        throw new BadRequestException("This invitation is invalid or expired");
      let user = await tx.user.findUnique({
        where: { email: invitation.email },
      });
      if (
        session &&
        session.expiresAt > new Date() &&
        session.user.email !== invitation.email
      )
        throw new ForbiddenException(
          "Sign out and use the invited email identity",
        );
      if (user) {
        if (
          !session ||
          session.expiresAt < new Date() ||
          session.userId !== user.id ||
          !user.active
        )
          throw new ForbiddenException(
            "Sign in with the invited email before accepting",
          );
      } else {
        if (!dto.password)
          throw new BadRequestException(
            "Set a password of at least 12 characters",
          );
        user = await tx.user.create({
          data: {
            email: invitation.email,
            passwordHash: await hash(dto.password, 12),
            emailVerifiedAt: new Date(),
          },
        });
      }
      const changed = await tx.invitation.updateMany({
        where: {
          id: invitation.id,
          status: "Pending",
          expiresAt: { gt: new Date() },
        },
        data: { status: "Accepted", acceptedAt: new Date() },
      });
      if (!changed.count)
        throw new BadRequestException("This invitation was already used");
      const existing = await tx.membership.findUnique({
        where: {
          userId_organizationId: {
            userId: user.id,
            organizationId: invitation.organizationId,
          },
        },
      });
      if (existing)
        throw new BadRequestException(
          "This account already has a company membership",
        );
      await tx.employee.update({
        where: {
          id: invitation.employeeId,
          organizationId: invitation.organizationId,
        },
        data: { userId: user.id, status: "Active" },
      });
      const membership = await tx.membership.create({
        data: {
          userId: user.id,
          organizationId: invitation.organizationId,
          employeeId: invitation.employeeId,
          role: invitation.role,
        },
      });
      await tx.user.update({
        where: { id: user.id },
        data: { emailVerifiedAt: new Date() },
      });
      const owned = await tx.membership.findMany({
        where: { userId: user.id, role: "OWNER" },
      });
      await tx.organization.updateMany({
        where: {
          id: { in: owned.map((member) => member.organizationId) },
          status: "Pending",
        },
        data: { status: "Active" },
      });
      if (session)
        await tx.session.update({
          where: { id: session.id },
          data: { membershipId: membership.id },
        });
      await tx.audit.create({
        data: {
          organizationId: invitation.organizationId,
          actorId: user.id,
          action: "invitation.accepted",
          entityId: invitation.id,
        },
      });
      const inviter = await tx.membership.findFirst({
        where: {
          userId: invitation.invitedBy,
          organizationId: invitation.organizationId,
        },
      });
      if (inviter)
        await tx.notification.create({
          data: {
            organizationId: invitation.organizationId,
            userId: inviter.userId,
            title: "Invitation accepted",
            body: `${invitation.email} joined your company.`,
          },
        });
      return {
        message:
          "Invitation accepted. Your company account is active. Sign in to continue.",
        next: "/login",
      };
    });
  }
}
type RequestWithCookie = { cookies?: Record<string, string> };
