import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Inject,
  UnauthorizedException,
  ForbiddenException,
  Controller,
  Post,
  Body,
  Res,
  Get,
  Req,
  UseGuards,
  HttpCode,
  BadRequestException,
} from "@nestjs/common";
import { Request, Response } from "express";
import { randomBytes, createHash } from "node:crypto";
import { compare, hash } from "bcryptjs";
import {
  User,
  Employee,
  Organization,
  Membership,
  Prisma,
} from "@prisma/client";
import { Db, tenantContext } from "./db";
import { Throttle } from "@nestjs/throttler";
import { LoginDto } from "./dto";
import {
  RegisterDto,
  EmailDto,
  TokenDto,
  ResetDto,
  SwitchDto,
} from "./saas.dto";
import { emailLink, queueMail } from "./mail";
export type Actor = Omit<User, "role"> & {
  role: string;
  employee: Employee | null;
  organization: Organization | null;
  membership: Membership | null;
  sessionId: string;
};
export type AuthRequest = Request & { actor: Actor };
export const digest = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export const newToken = () => randomBytes(32).toString("hex");
export function permit(actor: Actor, roles: string[]) {
  if (!roles.includes(actor.role))
    throw new ForbiddenException(
      "You do not have permission to perform this action",
    );
}
export function ownEmployee(actor: Actor) {
  if (!actor.employee)
    throw new ForbiddenException("Your account is not linked to an employee");
  return actor.employee.id;
}
export function companyId(actor: Actor) {
  if (!actor.organization)
    throw new ForbiddenException("Select an active company workspace");
  return actor.organization.id;
}
@Injectable()
export class IdentityGuard implements CanActivate {
  constructor(@Inject(Db) private db: Db) {}
  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<AuthRequest>();
    const token = req.cookies?.flurry_session;
    if (!token) throw new UnauthorizedException("Please sign in");
    const session = await this.db.system.session.findUnique({
      where: { id: digest(token) },
      include: { user: true },
    });
    if (!session || session.expiresAt < new Date() || !session.user.active)
      throw new UnauthorizedException("Your session has expired");
    const membership = session.membershipId
      ? await this.db.system.membership.findFirst({
          where: { id: session.membershipId, userId: session.userId },
          include: { organization: true },
        })
      : null;
    const employee = membership?.employeeId
      ? await this.db.system.employee.findFirst({
          where: {
            id: membership.employeeId,
            organizationId: membership.organizationId,
            userId: session.userId,
          },
        })
      : null;
    req.actor = {
      ...session.user,
      role:
        membership?.role ||
        (session.user.platformAdmin ? "PLATFORM_ADMIN" : "EMPLOYEE"),
      employee,
      organization: membership?.organization || null,
      membership,
      sessionId: session.id,
    };
    return true;
  }
}
@Injectable()
export class AuthGuard extends IdentityGuard {
  async canActivate(ctx: ExecutionContext) {
    await super.canActivate(ctx);
    const actor = ctx.switchToHttp().getRequest<AuthRequest>().actor;
    if (!actor.emailVerifiedAt)
      throw new ForbiddenException(
        "Verify your email before accessing company records",
      );
    if (
      !actor.membership?.active ||
      !actor.organization ||
      actor.organization.status !== "Active"
    )
      throw new ForbiddenException(
        "This company workspace is unavailable or suspended",
      );
    if (actor.employee && actor.employee.status !== "Active")
      throw new ForbiddenException("Your employment is inactive");
    const store = tenantContext.getStore();
    if (!store) throw new ForbiddenException("Company context is unavailable");
    store.organizationId = actor.organization.id;
    return true;
  }
}
@Injectable()
export class PlatformGuard extends IdentityGuard {
  async canActivate(ctx: ExecutionContext) {
    await super.canActivate(ctx);
    const actor = ctx.switchToHttp().getRequest<AuthRequest>().actor;
    if (!actor.platformAdmin || !actor.emailVerifiedAt)
      throw new ForbiddenException("Platform administrator access required");
    return true;
  }
}
export async function accountView(db: Db, userId: string, sessionId?: string) {
  const user = await db.system.user.findUniqueOrThrow({
    where: { id: userId },
  });
  const memberships = await db.system.membership.findMany({
    where: { userId, active: true },
    include: { organization: true },
  });
  const session = sessionId
    ? await db.system.session.findUnique({ where: { id: sessionId } })
    : null;
  const selected =
    memberships.find((m) => m.id === session?.membershipId) || null;
  const employee = selected?.employeeId
    ? await db.system.employee.findFirst({
        where: {
          id: selected.employeeId,
          organizationId: selected.organizationId,
          userId,
        },
      })
    : null;
  const next =
    user.platformAdmin && !selected
      ? "/platform"
      : !user.emailVerifiedAt
        ? "/verify-email"
        : !selected
          ? "/workspaces"
          : selected.organization.status !== "Active"
            ? "/workspaces"
            : !selected.organization.onboardingCompleted &&
                ["OWNER", "COMPANY_ADMIN", "SUPER_ADMIN"].includes(
                  selected.role,
                )
              ? "/company-onboarding"
              : "/workspace";
  return {
    id: user.id,
    email: user.email,
    role:
      selected?.role || (user.platformAdmin ? "PLATFORM_ADMIN" : "EMPLOYEE"),
    employee,
    platformAdmin: user.platformAdmin,
    emailVerified: !!user.emailVerifiedAt,
    organization: selected?.organization || null,
    membershipId: selected?.id || null,
    emailNotifications: selected?.emailNotifications ?? true,
    memberships: memberships.map((m) => ({
      id: m.id,
      role: m.role,
      organization: {
        id: m.organization.id,
        name: m.organization.name,
        status: m.organization.status,
      },
    })),
    next,
  };
}
export async function issueAccountToken(
  tx: Prisma.TransactionClient,
  user: Pick<User, "id" | "email">,
  kind: "Verification" | "Reset",
  organizationId?: string,
) {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id=${user.id} FOR UPDATE`;
  await tx.accountToken.updateMany({
    where: { userId: user.id, kind, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  await tx.mailJob.updateMany({
    where: {
      userId: user.id,
      subject:
        kind === "Verification"
          ? "Verify your FlurryPay HR account"
          : "Reset your FlurryPay HR password",
      status: { in: ["Queued", "Retry"] },
    },
    data: { status: "Superseded", body: "[Superseded account link]" },
  });
  const token = newToken();
  await tx.accountToken.create({
    data: {
      userId: user.id,
      hash: digest(token),
      kind,
      expiresAt: new Date(
        Date.now() + (kind === "Reset" ? 30 * 60000 : 24 * 3600000),
      ),
    },
  });
  await queueMail(tx, {
    userId: user.id,
    organizationId,
    to: user.email,
    subject:
      kind === "Verification"
        ? "Verify your FlurryPay HR account"
        : "Reset your FlurryPay HR password",
    body: `${kind === "Verification" ? "Verify your email to activate your company workspace" : "Reset your password"} using this single-use link:\n\n${emailLink(kind === "Verification" ? "/verify-email" : "/reset-password", token)}\n\nThis link expires ${kind === "Reset" ? "in 30 minutes" : "in 24 hours"}. If you did not request this, ignore this email.`,
  });
}
@Controller("auth")
export class AuthController {
  constructor(@Inject(Db) private db: Db) {}
  private async session(
    userId: string,
    res: Response,
    membershipId: string | null,
  ) {
    const token = newToken();
    const id = digest(token);
    await this.db.system.session.create({
      data: {
        id,
        userId,
        membershipId,
        expiresAt: new Date(Date.now() + 8 * 3600000),
      },
    });
    res.cookie("flurry_session", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 8 * 3600000,
      path: "/api",
    });
    return id;
  }
  @Post("register")
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const email = dto.email.toLowerCase().trim();
    const result = await this.db.system.$transaction(async (tx) => {
      if (await tx.user.findUnique({ where: { email } }))
        throw new BadRequestException(
          "Unable to create this account. Sign in or use password recovery if you already have an account.",
        );
      const user = await tx.user.create({
        data: { email, passwordHash: await hash(dto.password, 12) },
      });
      const slug =
        (dto.companyName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 50) || "company") +
        "-" +
        randomBytes(4).toString("hex");
      const org = await tx.organization.create({
        data: {
          name: dto.companyName.trim(),
          slug,
          businessEmail: email,
          country: dto.country,
          phone: dto.phone,
        },
      });
      const schedule = await tx.schedule.create({
        data: { organizationId: org.id, name: "Standard work week" },
      });
      const dept = await tx.department.create({
        data: { organizationId: org.id, name: "Administration" },
      });
      const names = dto.fullName.trim().split(/\s+/);
      const employee = await tx.employee.create({
        data: {
          organizationId: org.id,
          userId: user.id,
          email,
          firstName: names.shift()!,
          lastName: names.join(" ") || "",
          jobTitle: "Company owner",
          departmentId: dept.id,
          scheduleId: schedule.id,
          joinedAt: new Date(),
        },
      });
      const member = await tx.membership.create({
        data: {
          userId: user.id,
          organizationId: org.id,
          employeeId: employee.id,
          role: "OWNER",
        },
      });
      for (const name of ["Annual leave", "Sick leave", "Unpaid leave"])
        await tx.leaveType.create({ data: { organizationId: org.id, name } });
      await issueAccountToken(tx, user, "Verification", org.id);
      await tx.platformAudit.create({
        data: {
          actorId: user.id,
          action: "company.registered",
          organizationId: org.id,
        },
      });
      return { user, member };
    });
    const id = await this.session(result.user.id, res, result.member.id);
    return {
      ...(await accountView(this.db, result.user.id, id)),
      message:
        "Account created. Verification email queued; check delivery status and retry if needed.",
    };
  }
  @Post("login")
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = await this.db.system.user.findUnique({
      where: { email: dto.email.toLowerCase().trim() },
    });
    const valid = await compare(
      dto.password,
      user?.passwordHash ||
        "$2b$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW",
    );
    if (!user || !valid || !user.active) {
      await this.db.system.platformAudit.create({
        data: {
          actorId: "anonymous",
          action: "auth.failed",
          reason: "Invalid or inactive credentials",
        },
      });
      throw new UnauthorizedException("Email or password is incorrect");
    }
    const memberships = await this.db.system.membership.findMany({
      where: { userId: user.id, active: true },
    });
    const id = await this.session(
      user.id,
      res,
      !user.platformAdmin && memberships.length === 1
        ? memberships[0].id
        : null,
    );
    await this.db.system.platformAudit.create({
      data: { actorId: user.id, action: "auth.login" },
    });
    return accountView(this.db, user.id, id);
  }
  @Get("me")
  @UseGuards(IdentityGuard)
  me(@Req() req: AuthRequest) {
    return accountView(this.db, req.actor.id, req.actor.sessionId);
  }
  @Post("switch")
  @UseGuards(IdentityGuard)
  @HttpCode(200)
  async switchWorkspace(@Req() req: AuthRequest, @Body() dto: SwitchDto) {
    const m = await this.db.system.membership.findFirst({
      where: { id: dto.membershipId, userId: req.actor.id, active: true },
      include: { organization: true },
    });
    if (!m || m.organization.status === "Suspended")
      throw new ForbiddenException("Workspace unavailable");
    await this.db.system.session.update({
      where: { id: req.actor.sessionId },
      data: { membershipId: m.id },
    });
    return accountView(this.db, req.actor.id, req.actor.sessionId);
  }
  @Post("verify")
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async verify(@Body() dto: TokenDto) {
    await this.db.system.$transaction(async (tx) => {
      const token = await tx.accountToken.findUnique({
        where: { hash: digest(dto.token) },
      });
      if (
        !token ||
        token.kind !== "Verification" ||
        token.expiresAt < new Date() ||
        token.consumedAt
      )
        throw new BadRequestException(
          "This verification link is invalid or expired",
        );
      const changed = await tx.accountToken.updateMany({
        where: {
          id: token.id,
          consumedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { consumedAt: new Date() },
      });
      if (!changed.count)
        throw new BadRequestException("This link was already used");
      await tx.user.update({
        where: { id: token.userId },
        data: { emailVerifiedAt: new Date() },
      });
      const memberships = await tx.membership.findMany({
        where: { userId: token.userId, role: "OWNER" },
      });
      await tx.organization.updateMany({
        where: {
          id: { in: memberships.map((m) => m.organizationId) },
          status: "Pending",
        },
        data: { status: "Active" },
      });
      await tx.platformAudit.create({
        data: { actorId: token.userId, action: "account.verified" },
      });
    });
    return { ok: true, message: "Email verified. Sign in to continue." };
  }
  @Post("resend-verification")
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  async resend(@Body() dto: EmailDto) {
    const user = await this.db.system.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });
    if (user && !user.emailVerifiedAt)
      await this.db.system.$transaction((tx) =>
        issueAccountToken(tx, user, "Verification"),
      );
    return {
      message:
        "If this account needs verification, a new message has been queued. Delivery depends on your mail configuration.",
    };
  }
  @Post("forgot-password")
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  async forgot(@Body() dto: EmailDto) {
    const user = await this.db.system.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });
    if (user?.active)
      await this.db.system.$transaction((tx) =>
        issueAccountToken(tx, user, "Reset"),
      );
    return {
      message:
        "If an active account exists, a password-reset email has been queued.",
    };
  }
  @Post("reset-password")
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async reset(@Body() dto: ResetDto) {
    const passwordHash = await hash(dto.password, 12);
    await this.db.system.$transaction(async (tx) => {
      const token = await tx.accountToken.findUnique({
        where: { hash: digest(dto.token) },
      });
      if (
        !token ||
        token.kind !== "Reset" ||
        token.expiresAt < new Date() ||
        token.consumedAt
      )
        throw new BadRequestException(
          "This password-reset link is invalid or expired",
        );
      const updated = await tx.accountToken.updateMany({
        where: {
          id: token.id,
          consumedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { consumedAt: new Date() },
      });
      if (!updated.count)
        throw new BadRequestException("This link was already used");
      await tx.user.update({
        where: { id: token.userId },
        data: { passwordHash },
      });
      await tx.session.deleteMany({ where: { userId: token.userId } });
      await tx.platformAudit.create({
        data: { actorId: token.userId, action: "password.reset" },
      });
    });
    return { message: "Password updated. Sign in with your new password." };
  }
  @Get("delivery")
  @UseGuards(IdentityGuard)
  async delivery(@Req() req: AuthRequest) {
    return this.db.system.mailJob.findMany({
      where: { userId: req.actor.id },
      select: {
        id: true,
        subject: true,
        status: true,
        lastError: true,
        attempts: true,
        acceptedAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 10,
    });
  }
  @Post("logout")
  @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    if (req.cookies?.flurry_session)
      await this.db.system.session.deleteMany({
        where: { id: digest(req.cookies.flurry_session) },
      });
    res.clearCookie("flurry_session", { path: "/api" });
    return { ok: true };
  }
}
