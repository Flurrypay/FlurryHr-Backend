import { ValidateNested } from "class-validator";
import { Type } from "class-transformer";
import { AttendancePositionDto, verifyPosition } from "./work-location";
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Req,
  Res,
  Query,
  Inject,
  UseGuards,
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import {
  IsIn,
  IsOptional,
  IsUUID,
  Equals,
  IsBoolean,
  IsString,
  MinLength,
  MaxLength,
} from "class-validator";
import { Prisma } from "@prisma/client";
import { Response } from "express";
import { Db } from "./db";
import { AuthGuard, AuthRequest, companyId, ownEmployee, permit } from "./auth";
import { ADMIN } from "./domain";
import { paged } from "./pagination";
import {
  FaceProvider,
  faceConfigured,
  faceThresholds,
  protectFace,
  revealFace,
  FACE_CONSENT_VERSION,
  FACE_CONSENT_NOTICE,
} from "./face-provider";
export class StartFaceDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => AttendancePositionDto)
  position?: AttendancePositionDto;
  @IsIn(["Enrollment", "ClockIn", "ClockOut"]) purpose!: string;
  @IsOptional() @IsUUID() attendanceId?: string;
  @Equals(true) consent!: boolean;
}
export class FacePolicyDto {
  @IsBoolean() required!: boolean;
}
export class ReviewFaceDto {
  @IsIn(["Approved", "Rejected"]) status!: string;
  @IsString() @MinLength(8) @MaxLength(500) reason!: string;
}
export class ResetFaceDto {
  @IsString() @MinLength(8) @MaxLength(500) reason!: string;
}
const enrollmentSelect = {
  id: true,
  employeeId: true,
  status: true,
  version: true,
  consentAt: true,
  consentVersion: true,
  approvedBy: true,
  approvedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;
const faceBinding = (org: string, employee: string, version: number) =>
  `${org}|${employee}|${version}|face-v1`;
async function audit(
  tx: Prisma.TransactionClient,
  req: AuthRequest,
  action: string,
  id: string,
  details?: Prisma.InputJsonValue,
) {
  await tx.audit.create({
    data: {
      organizationId: companyId(req.actor),
      actorId: req.actor.id,
      action,
      entityId: id,
      details,
    },
  });
}
export async function consumeAttendanceFace(
  tx: Prisma.TransactionClient,
  actor: AuthRequest["actor"],
  purpose: string,
  id: string | undefined,
  attendanceId?: string,
) {
  const org = await tx.organization.findUniqueOrThrow({
    where: { id: companyId(actor) },
    select: { biometricAttendanceRequired: true },
  });
  if (!org.biometricAttendanceRequired) return null;
  if (!actor.sessionId)
    throw new ForbiddenException("A current authenticated session is required");
  if (!id)
    throw new ForbiddenException(
      "Complete a fresh face verification before marking attendance",
    );
  const enrollment = await tx.faceEnrollment.findUnique({
    where: {
      organizationId_employeeId: {
        organizationId: companyId(actor),
        employeeId: ownEmployee(actor),
      },
    },
  });
  if (
    !enrollment ||
    enrollment.status !== "Approved" ||
    !enrollment.referenceEncrypted
  )
    throw new ForbiddenException(
      "HR must approve your face enrollment before attendance",
    );
  const check = await tx.faceCheck.findFirst({
    where: {
      id,
      organizationId: companyId(actor),
      employeeId: ownEmployee(actor),
      userId: actor.id,
      authSessionId: actor.sessionId,
      purpose,
      targetAttendanceId: attendanceId ?? null,
      enrollmentVersion: enrollment.version,
      status: "Verified",
      expiresAt: { gt: new Date() },
    },
  });
  if (!check)
    throw new ForbiddenException(
      "Face verification expired, was used, or does not match this attendance action. Please retry",
    );
  const used = await tx.faceCheck.updateMany({
    where: { id: check.id, status: "Verified", expiresAt: { gt: new Date() } },
    data: {
      status: "Consumed",
      consumedAt: new Date(),
      attendanceId: attendanceId ?? null,
    },
  });
  if (used.count !== 1)
    throw new ForbiddenException("This face verification was already used");
  return {
    checkId: check.id,
    provider: "AWS Rekognition",
    enrollmentVersion: check.enrollmentVersion,
    liveness: check.liveness,
    similarity: check.similarity,
    verifiedAt: check.verifiedAt?.toISOString(),
  };
}
@Controller("biometrics")
@UseGuards(AuthGuard)
export class BiometricsController {
  constructor(
    @Inject(Db) private db: Db,
    @Inject(FaceProvider) private provider: FaceProvider,
  ) {}
  @Get("mine") async mine(@Req() req: AuthRequest) {
    const [org, enrollment] = await Promise.all([
      this.db.system.organization.findUniqueOrThrow({
        where: { id: companyId(req.actor) },
        select: { biometricAttendanceRequired: true },
      }),
      this.db.faceEnrollment.findUnique({
        where: {
          organizationId_employeeId: {
            organizationId: companyId(req.actor),
            employeeId: ownEmployee(req.actor),
          },
        },
        select: enrollmentSelect,
      }),
    ]);
    return {
      required: org.biometricAttendanceRequired,
      configured: faceConfigured(),
      enrollment,
      consentVersion: FACE_CONSENT_VERSION,
      consentNotice: FACE_CONSENT_NOTICE,
    };
  }
  @Get("policy") async policy(@Req() req: AuthRequest) {
    permit(req.actor, ADMIN);
    const org = await this.db.system.organization.findUniqueOrThrow({
      where: { id: companyId(req.actor) },
      select: { biometricAttendanceRequired: true },
    });
    return {
      required: org.biometricAttendanceRequired,
      configured: faceConfigured(),
      thresholds: faceThresholds(),
    };
  }
  @Patch("policy") async setPolicy(
    @Req() req: AuthRequest,
    @Body() dto: FacePolicyDto,
  ) {
    permit(req.actor, ["OWNER", "COMPANY_ADMIN", "SUPER_ADMIN"]);
    if (dto.required && !faceConfigured())
      throw new ServiceUnavailableException(
        "Configure AWS liveness and biometric encryption before enabling this policy",
      );
    faceThresholds();
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Organization" WHERE id=${companyId(req.actor)} FOR UPDATE`;
      await tx.organization.update({
        where: { id: companyId(req.actor) },
        data: { biometricAttendanceRequired: dto.required },
      });
      await audit(tx, req, "biometric.policy_updated", companyId(req.actor), {
        required: dto.required,
      });
      return { required: dto.required };
    });
  }
  @Post("sessions")
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async start(@Req() req: AuthRequest, @Body() dto: StartFaceDto) {
    if (!faceConfigured())
      throw new ServiceUnavailableException(
        "AWS face verification is not configured; contact HR",
      );
    faceThresholds();
    if (!req.actor.sessionId)
      throw new ForbiddenException(
        "A current authenticated session is required",
      );
    const employeeId = ownEmployee(req.actor),
      org = companyId(req.actor),
      expiresAt = new Date(Date.now() + 180000);
    const check = await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Employee" WHERE id=${employeeId} AND "organizationId"=${org} FOR UPDATE`;
      const employee = await tx.employee.findUniqueOrThrow({
        where: { id: employeeId },
      });
      if (employee.status !== "Active")
        throw new ForbiddenException("Your employee record is inactive");
      if (dto.purpose !== "Enrollment") {
        const organization = await tx.organization.findUniqueOrThrow({
          where: { id: org },
        });
        if (!dto.position)
          throw new BadRequestException(
            "Verify your current location before starting the face check",
          );
        verifyPosition(
          dto.position,
          employee.workArrangement === "Remote"
            ? employee.remoteWorkLocation
            : organization.attendanceLocation,
          employee.workArrangement === "Remote" ? "Remote" : "Company",
        );
      }
      let enrollment = await tx.faceEnrollment.findUnique({
        where: {
          organizationId_employeeId: { organizationId: org, employeeId },
        },
      });
      if (dto.purpose === "Enrollment") {
        if (enrollment && ["Approved", "Pending"].includes(enrollment.status))
          throw new BadRequestException(
            "An enrollment is awaiting approval or is already approved. Ask HR to reset it before replacing it",
          );
        enrollment = await tx.faceEnrollment.upsert({
          where: {
            organizationId_employeeId: { organizationId: org, employeeId },
          },
          create: {
            organizationId: org,
            employeeId,
            consentAt: new Date(),
            consentVersion: FACE_CONSENT_VERSION,
            status: "Capturing",
          },
          update: {
            version: { increment: 1 },
            status: "Capturing",
            referenceEncrypted: null,
            consentAt: new Date(),
            consentVersion: FACE_CONSENT_VERSION,
            approvedBy: null,
            approvedAt: null,
          },
        });
      } else if (
        !enrollment ||
        enrollment.status !== "Approved" ||
        !enrollment.referenceEncrypted
      )
        throw new ForbiddenException(
          "Complete enrollment and HR approval before verifying attendance",
        );
      if (dto.purpose === "ClockOut") {
        if (
          !dto.attendanceId ||
          !(await tx.attendance.findFirst({
            where: { id: dto.attendanceId, employeeId, clockOut: null },
          }))
        )
          throw new BadRequestException(
            "Choose your active attendance session",
          );
      } else if (dto.attendanceId)
        throw new BadRequestException(
          "An attendance session is only valid for clock-out verification",
        );
      await tx.faceCheck.updateMany({
        where: {
          employeeId,
          status: { in: ["Creating", "Started", "Verified"] },
        },
        data: { status: "Superseded" },
      });
      const created = await tx.faceCheck.create({
        data: {
          employeeId,
          userId: req.actor.id,
          authSessionId: req.actor.sessionId,
          purpose: dto.purpose,
          targetAttendanceId: dto.attendanceId ?? null,
          enrollmentVersion: enrollment!.version,
          expiresAt,
        },
      });
      await audit(tx, req, "biometric.session_started", created.id, {
        purpose: dto.purpose,
        consentVersion: FACE_CONSENT_VERSION,
      });
      return created;
    });
    try {
      const result = await this.provider.start(check.id, expiresAt);
      const changed = await this.db.faceCheck.updateMany({
        where: {
          id: check.id,
          status: "Creating",
          expiresAt: { gt: new Date() },
        },
        data: { providerSessionId: result.sessionId, status: "Started" },
      });
      if (!changed.count)
        throw new BadRequestException(
          "Session expired or was replaced; start a new check",
        );
      return { id: check.id, ...result, expiresAt };
    } catch (e) {
      await this.db.faceCheck.updateMany({
        where: { id: check.id, status: "Creating" },
        data: { status: "Failed", failureCode: "PROVIDER_START_FAILED" },
      });
      throw e;
    }
  }
  @Post("sessions/:id/complete")
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async complete(@Req() req: AuthRequest, @Param("id") id: string) {
    if (!req.actor.sessionId)
      throw new ForbiddenException(
        "A current authenticated session is required",
      );
    const employeeId = ownEmployee(req.actor),
      org = companyId(req.actor);
    const check = await this.db.faceCheck.findFirstOrThrow({
      where: {
        id,
        employeeId,
        userId: req.actor.id,
        authSessionId: req.actor.sessionId,
        status: "Started",
        expiresAt: { gt: new Date() },
      },
    });
    const claimed = await this.db.faceCheck.updateMany({
      where: { id, status: "Started", expiresAt: { gt: new Date() } },
      data: { status: "Verifying" },
    });
    if (!claimed.count)
      throw new BadRequestException(
        "This check is already being verified or expired",
      );
    try {
      const result = await this.provider.result(check.providerSessionId!);
      const threshold = faceThresholds();
      let similarity: number | null = null;
      if (
        !result.passed ||
        !Number.isFinite(result.confidence) ||
        result.confidence < threshold.liveness ||
        !result.image
      )
        throw new BadRequestException(
          "Liveness was not confirmed. Retry in good lighting or request HR assistance",
        );
      if (check.purpose !== "Enrollment") {
        const enrollment = await this.db.faceEnrollment.findUniqueOrThrow({
          where: {
            organizationId_employeeId: { organizationId: org, employeeId },
          },
        });
        if (
          enrollment.status !== "Approved" ||
          enrollment.version !== check.enrollmentVersion ||
          !enrollment.referenceEncrypted
        )
          throw new ForbiddenException(
            "Your enrollment changed; contact HR or start a new check",
          );
        similarity = await this.provider.compare(
          Buffer.from(
            revealFace(
              enrollment.referenceEncrypted,
              faceBinding(org, employeeId, enrollment.version),
            ),
            "base64",
          ),
          result.image,
        );
        if (!Number.isFinite(similarity) || similarity < threshold.similarity)
          throw new BadRequestException(
            "Face comparison was not confirmed. Retry or ask HR for review",
          );
      }
      const proof = await this.db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Employee" WHERE id=${employeeId} AND "organizationId"=${org} FOR UPDATE`;
        const employee = await tx.employee.findUniqueOrThrow({
          where: { id: employeeId },
        });
        if (employee.status !== "Active")
          throw new ForbiddenException("Your employee record is inactive");
        const enrollment = await tx.faceEnrollment.findUniqueOrThrow({
          where: {
            organizationId_employeeId: { organizationId: org, employeeId },
          },
        });
        if (
          enrollment.version !== check.enrollmentVersion ||
          (check.purpose === "Enrollment"
            ? enrollment.status !== "Capturing"
            : enrollment.status !== "Approved")
        )
          throw new ForbiddenException(
            "Your enrollment changed; start a new check",
          );
        const updated = await tx.faceCheck.updateMany({
          where: { id, status: "Verifying", expiresAt: { gt: new Date() } },
          data: {
            status: check.purpose === "Enrollment" ? "Enrolled" : "Verified",
            liveness: result.confidence,
            similarity,
            verifiedAt: new Date(),
          },
        });
        if (!updated.count)
          throw new BadRequestException(
            "Your check expired or was replaced; start again",
          );
        if (check.purpose === "Enrollment")
          await tx.faceEnrollment.update({
            where: { id: enrollment.id },
            data: {
              status: "Pending",
              referenceEncrypted: protectFace(
                result.image!.toString("base64"),
                faceBinding(org, employeeId, enrollment.version),
              ),
            },
          });
        await audit(
          tx,
          req,
          check.purpose === "Enrollment"
            ? "biometric.enrollment_submitted"
            : "biometric.verification_passed",
          id,
          { purpose: check.purpose, liveness: result.confidence, similarity },
        );
        return {
          id,
          status: check.purpose === "Enrollment" ? "Pending" : "Verified",
          expiresAt: check.expiresAt,
        };
      });
      return proof;
    } catch (e) {
      await this.db.$transaction(async (tx) => {
        await tx.faceCheck.updateMany({
          where: { id, status: "Verifying" },
          data: {
            status: "Failed",
            failureCode:
              e instanceof ServiceUnavailableException
                ? "PROVIDER_UNAVAILABLE"
                : "VERIFICATION_NOT_CONFIRMED",
          },
        });
        await audit(tx, req, "biometric.verification_failed", id, {
          purpose: check.purpose,
          code:
            e instanceof ServiceUnavailableException
              ? "PROVIDER_UNAVAILABLE"
              : "VERIFICATION_NOT_CONFIRMED",
        });
      });
      throw e;
    }
  }
  @Get("enrollments") async enrollments(
    @Req() req: AuthRequest,
    @Query() q: Record<string, string>,
  ) {
    permit(req.actor, ADMIN);
    return paged(
      this.db.faceEnrollment,
      {
        select: {
          ...enrollmentSelect,
          employee: {
            select: { firstName: true, lastName: true, email: true },
          },
        },
        filterFields: ["status", "employeeId"],
        orderBy: { createdAt: "desc" },
      },
      q,
    );
  }
  @Get("checks") async checks(
    @Req() req: AuthRequest,
    @Query() q: Record<string, string>,
  ) {
    permit(req.actor, ADMIN);
    return paged(
      this.db.faceCheck,
      {
        select: {
          id: true,
          employeeId: true,
          purpose: true,
          status: true,
          liveness: true,
          similarity: true,
          failureCode: true,
          createdAt: true,
          verifiedAt: true,
          consumedAt: true,
          attendanceId: true,
          employee: { select: { firstName: true, lastName: true } },
        },
        filterFields: ["status", "employeeId"],
        orderBy: { createdAt: "desc" },
      },
      q,
    );
  }
  @Get("enrollments/:id/image") async image(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Res() res: Response,
  ) {
    permit(req.actor, ADMIN);
    const e = await this.db.faceEnrollment.findUniqueOrThrow({ where: { id } });
    if (!e.referenceEncrypted || !["Pending", "Approved"].includes(e.status))
      throw new BadRequestException("No reference image is available");
    const bytes = Buffer.from(
      revealFace(
        e.referenceEncrypted,
        faceBinding(companyId(req.actor), e.employeeId, e.version),
      ),
      "base64",
    );
    await this.db.$transaction((tx) =>
      audit(tx, req, "biometric.reference_viewed", id),
    );
    res.setHeader("Cache-Control", "no-store");
    res.setHeader(
      "Content-Type",
      bytes[0] === 0x89 ? "image/png" : "image/jpeg",
    );
    res.send(bytes);
  }
  @Patch("enrollments/:id") async review(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() dto: ReviewFaceDto,
  ) {
    permit(req.actor, ADMIN);
    return this.db.$transaction(async (tx) => {
      const initial = await tx.faceEnrollment.findUniqueOrThrow({
        where: { id },
      });
      if (initial.employeeId === ownEmployee(req.actor))
        throw new ForbiddenException(
          "Another HR administrator must review your enrollment",
        );
      await tx.$queryRaw`SELECT id FROM "Employee" WHERE id=${initial.employeeId} AND "organizationId"=${companyId(req.actor)} FOR UPDATE`;
      const e = await tx.faceEnrollment.findUniqueOrThrow({ where: { id } });
      if (e.status !== "Pending" || !e.referenceEncrypted)
        throw new BadRequestException("Enrollment is not awaiting review");
      if (
        dto.status === "Approved" &&
        !(await tx.audit.findFirst({
          where: {
            actorId: req.actor.id,
            entityId: id,
            action: "biometric.reference_viewed",
            createdAt: { gte: e.consentAt },
          },
        }))
      )
        throw new BadRequestException(
          "View and verify the current reference image before approving enrollment",
        );
      await tx.faceEnrollment.update({
        where: { id },
        data: {
          status: dto.status,
          approvedBy: req.actor.id,
          approvedAt: new Date(),
          ...(dto.status === "Rejected" ? { referenceEncrypted: null } : {}),
        },
      });
      await audit(tx, req, "biometric.enrollment_reviewed", id, {
        status: dto.status,
        reason: dto.reason,
      });
      return { ok: true };
    });
  }
  @Delete("enrollment") async withdraw(@Req() req: AuthRequest) {
    return this.erase(
      req,
      ownEmployee(req.actor),
      "Employee withdrew biometric enrollment",
    );
  }
  @Post("employees/:id/reset") async reset(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() dto: ResetFaceDto,
  ) {
    permit(req.actor, ADMIN);
    return this.erase(req, id, dto.reason);
  }
  private async erase(req: AuthRequest, employeeId: string, reason: string) {
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Employee" WHERE id=${employeeId} AND "organizationId"=${companyId(req.actor)} FOR UPDATE`;
      const e = await tx.faceEnrollment.findFirstOrThrow({
        where: { employeeId },
      });
      await tx.faceEnrollment.update({
        where: { id: e.id },
        data: {
          status: "Revoked",
          referenceEncrypted: null,
          version: { increment: 1 },
          approvedBy: null,
          approvedAt: null,
        },
      });
      await tx.faceCheck.updateMany({
        where: {
          employeeId,
          status: { in: ["Creating", "Started", "Verifying", "Verified"] },
        },
        data: { status: "Superseded" },
      });
      await audit(tx, req, "biometric.enrollment_erased", e.id, { reason });
      return { ok: true };
    });
  }
}
