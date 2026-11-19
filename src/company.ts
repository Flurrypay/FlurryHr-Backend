import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Req,
  Inject,
  UseGuards,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
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
  @Get("invitations")
  async invitations(@Req() req: AuthRequest) {
    permit(req.actor, ADMIN);
    const items = await this.db.invitation.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        email: true,
        role: true,
        employeeId: true,
        status: true,
        expiresAt: true,
        createdAt: true,
        acceptedAt: true,
      },
    });
    const mail = await this.db.system.mailJob.findMany({
      where: { organizationId: companyId(req.actor) },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        referenceId: true,
        to: true,
        status: true,
        attempts: true,
        lastError: true,
        acceptedAt: true,
        createdAt: true,
      },
      take: 200,
    });
    const latest = items.filter(
      (item, index) =>
        items.findIndex((other) => other.employeeId === item.employeeId) ===
        index,
    );
    return latest.map((i) => ({
      ...i,
      status:
        i.status === "Pending" && i.expiresAt < new Date()
          ? "Expired"
          : i.status,
      delivery: mail.find((m) => m.referenceId === i.id) || null,
      deliveryHistory: mail.filter((m) =>
        items.some(
          (invitation) =>
            invitation.employeeId === i.employeeId &&
            invitation.id === m.referenceId,
        ),
      ),
    }));
  }
  @Post("invitations")
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async invite(@Req() req: AuthRequest, @Body() dto: InviteDto) {
    permit(req.actor, ADMIN);
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
      if (item.status === "Accepted" || item.status === "Revoked")
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
      const item = await tx.invitation.updateMany({
        where: { id, status: "Pending" },
        data: { status: "Revoked" },
      });
      if (!item.count)
        throw new NotFoundException("Pending invitation not found");
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
  @Get("mail")
  async mail(@Req() req: AuthRequest) {
    permit(req.actor, ADMIN);
    return this.db.system.mailJob.findMany({
      where: { organizationId: companyId(req.actor) },
      orderBy: { createdAt: "desc" },
      take: 100,
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
    });
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
  @Get("holidays") holidays() {
    return this.db.holiday.findMany({ orderBy: { date: "asc" } });
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
  @Get("notifications") notifications(@Req() req: AuthRequest) {
    return this.db.notification.findMany({
      where: { userId: req.actor.id },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
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
