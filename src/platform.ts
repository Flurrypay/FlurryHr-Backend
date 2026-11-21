import { paged } from "./pagination";
import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  Query,
  Req,
  Inject,
  UseGuards,
  ForbiddenException,
  BadRequestException,
} from "@nestjs/common";
import { compare } from "bcryptjs";
import { Throttle } from "@nestjs/throttler";
import { Db } from "./db";
import { mailConfigured } from "./mail";
import { PlatformGuard, AuthRequest } from "./auth";
import { SuspendDto } from "./saas.dto";
@Controller("platform")
@UseGuards(PlatformGuard)
export class PlatformController {
  constructor(@Inject(Db) private db: Db) {}
  @Get("overview") async overview() {
    const db = this.db.system;
    const [
      total,
      active,
      pending,
      suspended,
      users,
      invitations,
      accepted,
      mailFailures,
      activity,
      registrations,
    ] = await Promise.all([
      db.organization.count(),
      db.organization.count({ where: { status: "Active" } }),
      db.organization.count({ where: { onboardingCompleted: false } }),
      db.organization.count({ where: { status: "Suspended" } }),
      db.user.count({ where: { active: true } }),
      db.invitation.count(),
      db.invitation.count({ where: { status: "Accepted" } }),
      db.mailJob.count({ where: { status: { in: ["Failed", "Retry"] } } }),
      db.platformAudit.findMany({ orderBy: { createdAt: "desc" }, take: 30 }),
      db.$queryRaw<
        { createdAt: string; count: number }[]
      >`SELECT "createdAt"::date::text AS "createdAt",count(*)::int AS count FROM "Organization" WHERE "createdAt">=(now() AT TIME ZONE 'UTC')-interval '30 days' AND "createdAt"<=(now() AT TIME ZONE 'UTC') GROUP BY "createdAt"::date ORDER BY "createdAt"::date`,
    ]);
    return {
      metrics: {
        total,
        active,
        pending,
        suspended,
        users,
        invitations,
        accepted,
        mailFailures,
      },
      activity,
      registrations,
      usage: await db.$queryRaw<
        { date: string; sessions: number }[]
      >`SELECT "clockIn"::date::text AS date,count(*)::int AS sessions FROM "Attendance" WHERE "clockIn">=(now() at time zone 'UTC')-interval '30 days' GROUP BY "clockIn"::date ORDER BY "clockIn"::date`,
      health: {
        database: "Connected",
        emailConfigured: mailConfigured(),
        transport:
          process.env.NODE_ENV === "test" &&
          process.env.MAIL_TRANSPORT === "file"
            ? "Isolated test transport"
            : "Zoho API",
      },
    };
  }
  @Get("companies") async companies(@Query() q: Record<string, string>) {
    return paged(
      this.db.system.organization,
      {
        searchFields: ["name"],
        filterFields: ["status"],
        select: {
          id: true,
          name: true,
          slug: true,
          businessEmail: true,
          country: true,
          status: true,
          onboardingStep: true,
          onboardingCompleted: true,
          createdAt: true,
          _count: {
            select: {
              memberships: true,
              employees: true,
              attendance: true,
              invitations: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      },
      q,
    );
  }
  @Patch("companies/:id/status")
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async status(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() dto: SuspendDto,
  ) {
    if (!(await compare(dto.password, req.actor.passwordHash)))
      throw new ForbiddenException(
        "Re-enter your platform administrator password",
      );
    return this.db.system.$transaction(async (tx) => {
      const org = await tx.organization.findUnique({ where: { id } });
      if (!org) throw new BadRequestException("Company not found");
      if (org.status === "Pending")
        throw new BadRequestException(
          "Pending companies must verify their owner email before activation",
        );
      await tx.organization.update({
        where: { id },
        data: { status: dto.status },
      });
      // Suspension is enforced against the organisation on every tenant request.
      await tx.platformAudit.create({
        data: {
          actorId: req.actor.id,
          action:
            dto.status === "Suspended"
              ? "company.suspended"
              : "company.reactivated",
          organizationId: id,
          reason: dto.reason,
        },
      });
      return { ok: true };
    });
  }
}
