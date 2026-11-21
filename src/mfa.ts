import {
  Controller,
  Get,
  Post,
  Body,
  Req,
  Inject,
  UseGuards,
  ForbiddenException,
  BadRequestException,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { IsString, MinLength, MaxLength } from "class-validator";
import { compare } from "bcryptjs";
import { Prisma, User } from "@prisma/client";
import { Db } from "./db";
import { IdentityGuard, AuthRequest } from "./auth";
import { encrypt, decrypt, queueMail } from "./mail";
import {
  newTotpSecret,
  verifyTotp,
  newRecoveryCodes,
  recoveryDigest,
} from "./totp";
class PasswordDto {
  @IsString() @MinLength(1) @MaxLength(128) currentPassword!: string;
}
class ProofDto extends PasswordDto {
  @IsString() @MinLength(6) @MaxLength(80) code!: string;
}
@Controller("auth/mfa")
@UseGuards(IdentityGuard)
export class MfaController {
  constructor(@Inject(Db) private db: Db) {}
  private async attempt<T>(
    req: AuthRequest,
    run: (tx: Prisma.TransactionClient) => Promise<T>,
  ) {
    try {
      return await this.db.system.$transaction(run);
    } catch (error) {
      await this.db.system.platformAudit.create({
        data: {
          actorId: req.actor.id,
          action: "mfa.failed",
          reason: "MFA operation denied or failed",
        },
      });
      throw error;
    }
  }
  private eligible(req: AuthRequest) {
    if (!req.actor.platformAdmin || !req.actor.emailVerifiedAt)
      throw new ForbiddenException(
        "Verified platform administrator account required",
      );
  }
  private async locked(
    tx: Prisma.TransactionClient,
    req: AuthRequest,
    password: string,
  ) {
    this.eligible(req);
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${req.actor.id} FOR UPDATE`;
    const user = await tx.user.findUniqueOrThrow({
      where: { id: req.actor.id },
    });
    if (!user.active || !user.platformAdmin || !user.emailVerifiedAt)
      throw new ForbiddenException(
        "Verified active platform administrator required",
      );
    if (!(await compare(password, user.passwordHash)))
      throw new ForbiddenException("Current password is incorrect");
    return user;
  }
  private async proof(
    tx: Prisma.TransactionClient,
    user: User,
    code: string,
    allowRecovery = true,
  ) {
    if (!user.mfaSecretEncrypted)
      throw new BadRequestException("Enroll an authenticator first");
    if (
      allowRecovery &&
      /^[a-f0-9]{32}$/i.test(code.replace(/-/g, "").trim())
    ) {
      const used = await tx.mfaRecoveryCode.updateMany({
        where: {
          userId: user.id,
          hash: recoveryDigest(code),
          consumedAt: null,
        },
        data: { consumedAt: new Date() },
      });
      if (used.count === 1) return "recovery";
    }
    const step = verifyTotp(
      decrypt(user.mfaSecretEncrypted),
      code,
      user.mfaLastUsedStep,
    );
    if (step !== null) {
      await tx.user.update({
        where: { id: user.id },
        data: { mfaLastUsedStep: step },
      });
      return "totp";
    }
    throw new BadRequestException(
      "Code is invalid, expired or already used. Use a new authenticator code or an unused recovery code.",
    );
  }
  private async codes(tx: Prisma.TransactionClient, userId: string) {
    const codes = newRecoveryCodes();
    await tx.mfaRecoveryCode.deleteMany({ where: { userId } });
    await tx.mfaRecoveryCode.createMany({
      data: codes.map((code) => ({ userId, hash: recoveryDigest(code) })),
    });
    return codes;
  }
  @Get("status") async status(@Req() req: AuthRequest) {
    this.eligible(req);
    return {
      enrolled: !!req.actor.mfaSecretEncrypted,
      recoveryCodesRemaining: await this.db.system.mfaRecoveryCode.count({
        where: { userId: req.actor.id, consumedAt: null },
      }),
    };
  }
  @Post("enroll")
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async enroll(@Req() req: AuthRequest, @Body() dto: PasswordDto) {
    return this.attempt(req, async (tx) => {
      const user = await this.locked(tx, req, dto.currentPassword);
      if (user.mfaSecretEncrypted)
        throw new BadRequestException(
          "MFA is already enrolled. Use the reset flow to change authenticators.",
        );
      const secret = newTotpSecret();
      await tx.mfaEnrollment.upsert({
        where: { userId: user.id },
        create: {
          userId: user.id,
          secretEncrypted: encrypt(secret),
          expiresAt: new Date(Date.now() + 10 * 60000),
        },
        update: {
          secretEncrypted: encrypt(secret),
          expiresAt: new Date(Date.now() + 10 * 60000),
        },
      });
      await tx.platformAudit.create({
        data: { actorId: user.id, action: "mfa.enrollment_started" },
      });
      return {
        secret,
        otpauthUri: `otpauth://totp/${encodeURIComponent("FlurryPay HR:" + user.email)}?secret=${secret}&issuer=FlurryPay%20HR&algorithm=SHA1&digits=6&period=30`,
      };
    });
  }
  @Post("confirm")
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async confirm(@Req() req: AuthRequest, @Body() dto: ProofDto) {
    return this.attempt(req, async (tx) => {
      const user = await this.locked(tx, req, dto.currentPassword),
        pending = await tx.mfaEnrollment.findUnique({
          where: { userId: user.id },
        });
      if (user.mfaSecretEncrypted || !pending || pending.expiresAt < new Date())
        throw new BadRequestException("Start a new authenticator enrollment");
      const step = verifyTotp(decrypt(pending.secretEncrypted), dto.code, null);
      if (step === null)
        throw new BadRequestException(
          "Authenticator code is incorrect or expired",
        );
      await tx.user.update({
        where: { id: user.id },
        data: {
          mfaSecretEncrypted: pending.secretEncrypted,
          mfaEnabledAt: new Date(),
          mfaLastUsedStep: step,
        },
      });
      await tx.mfaEnrollment.delete({ where: { userId: user.id } });
      await tx.session.deleteMany({
        where: { userId: user.id, id: { not: req.actor.sessionId } },
      });
      await tx.session.update({
        where: { id: req.actor.sessionId },
        data: { mfaVerifiedAt: new Date() },
      });
      const recoveryCodes = await this.codes(tx, user.id);
      await tx.platformAudit.create({
        data: { actorId: user.id, action: "mfa.enabled" },
      });
      await queueMail(tx, {
        userId: user.id,
        to: user.email,
        subject: "FlurryPay HR platform MFA enabled",
        body: "An authenticator was enrolled on your platform account. Other sessions were signed out. Keep your recovery codes private and offline.",
      });
      return { recoveryCodes, next: "/platform" };
    });
  }
  @Post("verify")
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async verify(@Req() req: AuthRequest, @Body() dto: ProofDto) {
    return this.attempt(req, async (tx) => {
      const user = await this.locked(tx, req, dto.currentPassword),
        method = await this.proof(tx, user, dto.code);
      await tx.session.update({
        where: { id: req.actor.sessionId },
        data: { mfaVerifiedAt: new Date() },
      });
      await tx.platformAudit.create({
        data: {
          actorId: user.id,
          action: method === "recovery" ? "mfa.recovery_used" : "mfa.verified",
        },
      });
      if (method === "recovery")
        await queueMail(tx, {
          userId: user.id,
          to: user.email,
          subject: "FlurryPay HR recovery code used",
          body: "A recovery code was used to access your platform account. If this was not you, change your password and reset your authenticator immediately.",
        });
      return { next: "/platform" };
    });
  }
  @Post("reset")
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async reset(@Req() req: AuthRequest, @Body() dto: ProofDto) {
    return this.attempt(req, async (tx) => {
      const user = await this.locked(tx, req, dto.currentPassword);
      await this.proof(tx, user, dto.code);
      await tx.user.update({
        where: { id: user.id },
        data: {
          mfaSecretEncrypted: null,
          mfaEnabledAt: null,
          mfaLastUsedStep: null,
        },
      });
      await tx.mfaRecoveryCode.deleteMany({ where: { userId: user.id } });
      await tx.mfaEnrollment.deleteMany({ where: { userId: user.id } });
      await tx.session.deleteMany({
        where: { userId: user.id, id: { not: req.actor.sessionId } },
      });
      await tx.session.update({
        where: { id: req.actor.sessionId },
        data: { mfaVerifiedAt: null },
      });
      await tx.platformAudit.create({
        data: { actorId: user.id, action: "mfa.reset" },
      });
      await queueMail(tx, {
        userId: user.id,
        to: user.email,
        subject: "FlurryPay HR authenticator reset",
        body: "Your platform authenticator was reset after password and second-factor verification. All other sessions were signed out. Enrollment is required before platform access resumes.",
      });
      return { next: "/platform-security" };
    });
  }
  @Post("recovery-codes")
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async regenerate(@Req() req: AuthRequest, @Body() dto: ProofDto) {
    return this.attempt(req, async (tx) => {
      const user = await this.locked(tx, req, dto.currentPassword);
      await this.proof(tx, user, dto.code, false);
      const recoveryCodes = await this.codes(tx, user.id);
      await tx.platformAudit.create({
        data: { actorId: user.id, action: "mfa.recovery_codes_rotated" },
      });
      return { recoveryCodes };
    });
  }
}
