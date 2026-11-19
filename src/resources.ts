import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Req,
  Res,
  Inject,
  UseGuards,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from "@nestjs/common";
import { Response } from "express";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { Db } from "./db";
import { AuthGuard, AuthRequest, permit, ownEmployee, companyId } from "./auth";
import { ADMIN, PEOPLE } from "./domain";
import {
  AssetDto,
  AssetAssignmentDto,
  ReviewDto,
  AssessmentDto,
  DocumentDto,
} from "./saas.dto";
import { notifyEmployee } from "./notifications";
@Controller()
@UseGuards(AuthGuard)
export class ResourcesController {
  constructor(@Inject(Db) private db: Db) {}
  private async employee(req: AuthRequest, id: string) {
    const item = await this.db.employee.findFirst({
      where: {
        id,
        ...(!ADMIN.includes(req.actor.role)
          ? {
              OR: [
                { id: ownEmployee(req.actor) },
                { managerId: ownEmployee(req.actor) },
              ],
            }
          : {}),
      },
    });
    if (!item) throw new NotFoundException("Employee not found");
    return item;
  }
  @Get("documents") documents(@Req() req: AuthRequest) {
    return this.db.document.findMany({
      where: ADMIN.includes(req.actor.role)
        ? {}
        : {
            OR: [{ employeeId: null }, { employeeId: ownEmployee(req.actor) }],
          },
      select: {
        id: true,
        name: true,
        category: true,
        mime: true,
        bytes: true,
        employeeId: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }
  @Post("documents") async upload(
    @Req() req: AuthRequest,
    @Body() dto: DocumentDto,
  ) {
    permit(req.actor, ADMIN);
    if (!dto.employeeId && dto.category !== "Policy")
      throw new BadRequestException(
        "Choose an employee owner for private documents; only policies can be company-wide",
      );
    if (dto.employeeId) await this.employee(req, dto.employeeId);
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(dto.dataBase64))
      throw new BadRequestException("Invalid file encoding");
    const bytes = Buffer.from(dto.dataBase64, "base64");
    if (!bytes.length || bytes.length > 5 * 1024 * 1024)
      throw new BadRequestException("Choose a file up to 5 MB");
    const valid =
      dto.mime === "application/pdf"
        ? bytes.subarray(0, 5).toString() === "%PDF-"
        : dto.mime === "image/png"
          ? bytes
              .subarray(0, 8)
              .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          : dto.mime === "image/jpeg"
            ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
            : !bytes.includes(0);
    if (!valid)
      throw new BadRequestException(
        "File content does not match its declared type",
      );
    if (dto.mime === "text/plain")
      try {
        new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        throw new BadRequestException("Text files must contain valid UTF-8");
      }
    const directory = path.resolve(
      process.env.DOCUMENT_STORAGE_DIR || ".local/documents",
    );
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const key = randomUUID();
    const target = path.join(directory, key);
    await writeFile(target, bytes, { mode: 0o600 });
    try {
      return await this.db.$transaction(async (tx) => {
        const file = await tx.document.create({
          data: {
            employeeId: dto.employeeId,
            name: (() => {
              const name = dto.name.replace(/[\r\n\0]/g, "");
              const ext =
                dto.mime === "application/pdf"
                  ? ".pdf"
                  : dto.mime === "image/png"
                    ? ".png"
                    : dto.mime === "image/jpeg"
                      ? ".jpg"
                      : ".txt";
              return name.toLowerCase().endsWith(ext) ? name : name + ext;
            })(),
            category: dto.category,
            mime: dto.mime,
            bytes: bytes.length,
            storageKey: key,
            uploadedBy: req.actor.id,
          },
        });
        await tx.audit.create({
          data: {
            actorId: req.actor.id,
            action: "document.uploaded",
            entityId: file.id,
          },
        });
        return { id: file.id, name: file.name };
      });
    } catch (e) {
      await unlink(target).catch(() => {});
      throw e;
    }
  }
  @Get("documents/:id/download") async download(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Res() res: Response,
  ) {
    const file = await this.db.document.findFirst({
      where: {
        id,
        ...(ADMIN.includes(req.actor.role)
          ? {}
          : {
              OR: [
                { employeeId: null },
                { employeeId: ownEmployee(req.actor) },
              ],
            }),
      },
    });
    if (!file) throw new NotFoundException("Document not found");
    const bytes = await readFile(
      path.join(
        path.resolve(process.env.DOCUMENT_STORAGE_DIR || ".local/documents"),
        file.storageKey,
      ),
    ).catch(() => {
      throw new NotFoundException("Document content is unavailable");
    });
    await this.db.audit.create({
      data: {
        actorId: req.actor.id,
        action: "document.downloaded",
        entityId: id,
      },
    });
    res.setHeader("Content-Type", file.mime);
    res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${file.name.replace(/[^a-zA-Z0-9._ -]/g, "_")}"`,
    );
    res.send(bytes);
  }
  @Get("assets") async assets(@Req() req: AuthRequest) {
    return this.db.asset.findMany({
      where: ADMIN.includes(req.actor.role)
        ? {}
        : { employeeId: ownEmployee(req.actor) },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }
  @Post("assets") async createAsset(
    @Req() req: AuthRequest,
    @Body() dto: AssetDto,
  ) {
    permit(req.actor, ADMIN);
    return this.db.$transaction(async (tx) => {
      const item = await tx.asset.create({ data: dto });
      await tx.audit.create({
        data: {
          actorId: req.actor.id,
          action: "asset.created",
          entityId: item.id,
        },
      });
      return item;
    });
  }
  @Patch("assets/:id/assignment") async assignment(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() dto: AssetAssignmentDto,
  ) {
    permit(req.actor, ADMIN);
    if (dto.employeeId) {
      const employee = await this.employee(req, dto.employeeId);
      if (employee.status !== "Active")
        throw new BadRequestException("Choose an active employee");
    }
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Asset" WHERE id=${id} AND "organizationId"=${companyId(req.actor)} FOR UPDATE`;
      const asset = await tx.asset.findUniqueOrThrow({ where: { id } });
      if (dto.employeeId && asset.employeeId)
        throw new BadRequestException(
          "Return the current assignment before assigning this asset again",
        );
      if (!dto.employeeId && !asset.employeeId)
        throw new BadRequestException("This asset is not assigned");
      const item = await tx.asset.update({
        where: { id },
        data: {
          employeeId: dto.employeeId || null,
          status: dto.employeeId ? "Assigned" : "Available",
        },
      });
      await tx.assetHistory.create({
        data: {
          assetId: id,
          employeeId: dto.employeeId || asset.employeeId,
          action: dto.employeeId ? "Assigned" : "Returned",
          reason: dto.reason,
          actorId: req.actor.id,
        },
      });
      await tx.audit.create({
        data: {
          actorId: req.actor.id,
          action: dto.employeeId ? "asset.assigned" : "asset.returned",
          entityId: id,
        },
      });
      return item;
    });
  }
  @Get("assets/:id/history") async assetHistory(
    @Req() req: AuthRequest,
    @Param("id") id: string,
  ) {
    permit(req.actor, ADMIN);
    if (!(await this.db.asset.findUnique({ where: { id } })))
      throw new NotFoundException();
    return this.db.assetHistory.findMany({
      where: { assetId: id },
      orderBy: { createdAt: "desc" },
    });
  }
  @Get("performance") reviews(@Req() req: AuthRequest) {
    return this.db.performanceReview.findMany({
      where: ADMIN.includes(req.actor.role)
        ? {}
        : req.actor.role === "MANAGER"
          ? { employeeId: { in: [] } }
          : { employeeId: ownEmployee(req.actor) },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }
  @Get("performance/team") async teamReviews(@Req() req: AuthRequest) {
    permit(req.actor, PEOPLE);
    const employees = await this.db.employee.findMany({
      where: ADMIN.includes(req.actor.role)
        ? {}
        : {
            OR: [
              { managerId: ownEmployee(req.actor) },
              { id: ownEmployee(req.actor) },
            ],
          },
      select: { id: true },
    });
    return this.db.performanceReview.findMany({
      where: { employeeId: { in: employees.map((e) => e.id) } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }
  @Post("performance") async review(
    @Req() req: AuthRequest,
    @Body() dto: ReviewDto,
  ) {
    permit(req.actor, PEOPLE);
    await this.employee(req, dto.employeeId);
    return this.db.$transaction(async (tx) => {
      const item = await tx.performanceReview.create({ data: dto });
      await tx.audit.create({
        data: {
          actorId: req.actor.id,
          action: "performance.goal_assigned",
          entityId: item.id,
        },
      });
      await notifyEmployee(
        tx,
        companyId(req.actor),
        dto.employeeId,
        "New performance goal",
        "A new goal and review period are available.",
      );
      return item;
    });
  }
  @Patch("performance/:id/self") async selfAssessment(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() dto: AssessmentDto,
  ) {
    return this.db.$transaction(async (tx) => {
      const item = await tx.performanceReview.findFirst({
        where: { id, employeeId: ownEmployee(req.actor), status: "Draft" },
      });
      if (!item) throw new NotFoundException("Draft review not found");
      await tx.performanceReview.update({
        where: { id },
        data: { selfAssessment: dto.assessment, status: "Submitted" },
      });
      await tx.audit.create({
        data: {
          actorId: req.actor.id,
          action: "performance.self_submitted",
          entityId: id,
        },
      });
      return { ok: true };
    });
  }
  @Patch("performance/:id/manager") async managerAssessment(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() dto: AssessmentDto,
  ) {
    permit(req.actor, PEOPLE);
    return this.db.$transaction(async (tx) => {
      const item = await tx.performanceReview.findUniqueOrThrow({
        where: { id },
      });
      await this.employee(req, item.employeeId);
      if (item.employeeId === req.actor.employee?.id)
        throw new ForbiddenException("Another manager must assess your review");
      const changed = await tx.performanceReview.updateMany({
        where: { id, status: "Submitted" },
        data: { managerAssessment: dto.assessment, status: "Completed" },
      });
      if (!changed.count)
        throw new BadRequestException(
          "The employee must submit their self-assessment first",
        );
      await tx.audit.create({
        data: {
          actorId: req.actor.id,
          action: "performance.manager_submitted",
          entityId: id,
        },
      });
      await notifyEmployee(
        tx,
        companyId(req.actor),
        item.employeeId,
        "Performance review completed",
        "Your manager completed a performance review.",
      );
      return { ok: true };
    });
  }
}
