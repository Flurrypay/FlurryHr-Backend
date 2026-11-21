import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Req,
  Res,
  Query,
  Inject,
  UseGuards,
  ForbiddenException,
  BadRequestException,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { IsString, MinLength, MaxLength } from "class-validator";
import { compare, hash } from "bcryptjs";
import { Response } from "express";
import { Db } from "./db";
import { AuthRequest, IdentityGuard, platformMfaSatisfied } from "./auth";
import { queueMail } from "./mail";
import { pagination, rawCursor, readRawCursor } from "./pagination";
class ReauthenticateDto {
  @IsString() @MinLength(1) @MaxLength(128) currentPassword!: string;
}
class ChangePasswordDto extends ReauthenticateDto {
  @IsString() @MinLength(12) @MaxLength(128) newPassword!: string;
}
@Controller("account")
@UseGuards(IdentityGuard)
export class AccountSecurityController {
  constructor(@Inject(Db) private db: Db) {}
  private permitted(req: AuthRequest) {
    if (req.actor.platformAdmin && !platformMfaSatisfied(req.actor))
      throw new ForbiddenException("Complete platform MFA verification");
  }
  @Get("sessions") async sessions(
    @Req() req: AuthRequest,
    @Query() q: Record<string, string>,
  ) {
    this.permitted(req);
    const { page, limit, skip } = pagination(q);
    const where = { userId: req.actor.id, expiresAt: { gt: new Date() } };
    const cursorScope = "account-sessions:" + req.actor.id;
    const after = readRawCursor(q.after, cursorScope, 2);
    const continuation = after
      ? {
          OR: [
            { expiresAt: { lt: new Date(after[0]) } },
            { expiresAt: new Date(after[0]), id: { gt: after[1] } },
          ],
        }
      : {};

    const [items, total] = await Promise.all([
      this.db.system.session.findMany({
        where: { AND: [where, continuation] },
        select: { id: true, expiresAt: true },
        orderBy: [{ expiresAt: "desc" }, { id: "asc" }],
        take: limit,
        skip: after ? 0 : skip,
      }),
      this.db.system.session.count({ where }),
    ]);
    const last = items.at(-1);
    return {
      nextCursor: rawCursor(
        cursorScope,
        last && [last.expiresAt.toISOString(), last.id],
      ),
      items: items.map((item) => ({
        ...item,
        current: item.id === req.actor.sessionId,
      })),
      total,
      page,
      limit,
    };
  }
  @Post("password")
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async password(@Req() req: AuthRequest, @Body() dto: ChangePasswordDto) {
    this.permitted(req);
    if (dto.currentPassword === dto.newPassword)
      throw new BadRequestException("Choose a different password");
    const newHash = await hash(dto.newPassword, 12);
    await this.db.system.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${req.actor.id} FOR UPDATE`;
      const user = await tx.user.findUniqueOrThrow({
        where: { id: req.actor.id },
      });
      if (!(await compare(dto.currentPassword, user.passwordHash)))
        throw new ForbiddenException("Current password is incorrect");
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash: newHash },
      });
      await tx.session.deleteMany({
        where: { userId: user.id, id: { not: req.actor.sessionId } },
      });
      await tx.accountToken.updateMany({
        where: { userId: user.id, kind: "Reset", consumedAt: null },
        data: { consumedAt: new Date() },
      });
      await tx.platformAudit.create({
        data: { actorId: user.id, action: "account.password_changed" },
      });
      await queueMail(tx, {
        userId: user.id,
        to: user.email,
        subject: "Your FlurryPay HR password changed",
        body: "Your account password was changed and other sessions were signed out. If this was not you, reset your password immediately.",
      });
    });
    return { message: "Password changed. Other devices have been signed out." };
  }
  @Post("sessions/:id/revoke")
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async revoke(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() dto: ReauthenticateDto,
  ) {
    this.permitted(req);
    if (!(await compare(dto.currentPassword, req.actor.passwordHash)))
      throw new ForbiddenException("Current password is incorrect");
    if (id === req.actor.sessionId)
      throw new BadRequestException("Use Sign out to end this session");
    const result = await this.db.system.session.deleteMany({
      where: { id, userId: req.actor.id },
    });
    if (!result.count)
      throw new BadRequestException("Session no longer exists");
    await this.db.system.platformAudit.create({
      data: { actorId: req.actor.id, action: "account.session_revoked" },
    });
    return { message: "Session signed out." };
  }
  @Post("sessions/revoke-others")
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async revokeOthers(@Req() req: AuthRequest, @Body() dto: ReauthenticateDto) {
    this.permitted(req);
    if (!(await compare(dto.currentPassword, req.actor.passwordHash)))
      throw new ForbiddenException("Current password is incorrect");
    await this.db.system.$transaction(async (tx) => {
      await tx.session.deleteMany({
        where: { userId: req.actor.id, id: { not: req.actor.sessionId } },
      });
      await tx.platformAudit.create({
        data: {
          actorId: req.actor.id,
          action: "account.other_sessions_revoked",
        },
      });
    });
    return { message: "Other sessions signed out." };
  }
  @Post("sessions/sign-out-all")
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async signOutAll(
    @Req() req: AuthRequest,
    @Body() dto: ReauthenticateDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.permitted(req);
    if (!(await compare(dto.currentPassword, req.actor.passwordHash)))
      throw new ForbiddenException("Current password is incorrect");
    await this.db.system.$transaction(async (tx) => {
      await tx.session.deleteMany({ where: { userId: req.actor.id } });
      await tx.platformAudit.create({
        data: { actorId: req.actor.id, action: "account.all_sessions_revoked" },
      });
    });
    res.clearCookie("flurry_session", { path: "/api" });
    return { message: "All devices signed out." };
  }
}
