import "reflect-metadata";
import "dotenv/config";
import { MfaController } from "./mfa";
import { AccountSecurityController } from "./account-security";
import { AttendanceCalculation } from "./attendance-calculation";
import {
  Module,
  ValidationPipe,
  Catch,
  ExceptionFilter,
  ArgumentsHost,
  HttpException,
} from "@nestjs/common";
import { APP_GUARD, NestFactory } from "@nestjs/core";
import { ThrottlerModule, ThrottlerGuard } from "@nestjs/throttler";
import { Prisma } from "@prisma/client";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { Request, Response, NextFunction } from "express";
import { Db, tenantContext } from "./db";
import {
  AuthGuard,
  IdentityGuard,
  PlatformGuard,
  AuthController,
} from "./auth";
import { HrController } from "./hr";
import { AttendanceController } from "./attendance";
import { DashboardController } from "./dashboard";
import { CompanyController, InvitationController } from "./company";
import { PlatformController } from "./platform";
import { ResourcesController } from "./resources";
import { MailWorker } from "./mail";
import { json } from "express";
import { randomUUID } from "node:crypto";
import { HealthController } from "./health";
@Catch()
class Errors implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (error instanceof HttpException)
      return res.status(error.getStatus()).json(error.getResponse());
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      const status =
        error.code === "P2025"
          ? 404
          : ["P2002", "P2003", "P2004", "P2010", "P2034"].includes(error.code)
            ? 409
            : 500;
      return res.status(status).json({
        message:
          status === 404
            ? "Record not found"
            : status === 409
              ? "This record conflicts with existing data. Check duplicates and related records, then try again."
              : "Unable to complete this request",
      });
    }
    console.error(
      "Unhandled request error",
      error instanceof Error ? error.name : "UnknownError",
    );
    return res.status(500).json({ message: "Unable to complete this request" });
  }
}
@Module({
  imports: [ThrottlerModule.forRoot([{ ttl: 60000, limit: 180 }])],
  controllers: [
    MfaController,
    AccountSecurityController,
    AuthController,
    HrController,
    AttendanceController,
    DashboardController,
    CompanyController,
    InvitationController,
    PlatformController,
    ResourcesController,
    HealthController,
  ],
  providers: [
    Db,
    AttendanceCalculation,
    AuthGuard,
    IdentityGuard,
    PlatformGuard,
    MailWorker,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
class AppModule {}
async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.setGlobalPrefix("api");
  app.use(helmet());
  if (
    process.env.NODE_ENV === "production" &&
    (!process.env.WEB_ORIGIN?.startsWith("https://") ||
      !/^[a-f0-9]{64}$/i.test(process.env.MAIL_ENCRYPTION_KEY || "") ||
      process.env.MAIL_TRANSPORT === "file")
  )
    throw new Error(
      "Invalid production origin or mail encryption/transport configuration",
    );
  app.use(cookieParser());
  app.use(json({ limit: "8mb" }));
  app.use((_req: Request, _res: Response, next: NextFunction) =>
    tenantContext.run({}, () => next()),
  );
  const origin = process.env.WEB_ORIGIN || "http://localhost:5173";
  app.enableCors({ origin, credentials: true });
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.headers.origin !== origin
    )
      return res.status(403).json({ message: "Request origin is not allowed" });
    res.setHeader("Cache-Control", "no-store");
    if (
      process.env.NODE_ENV === "test" &&
      process.env.MAIL_TRANSPORT === "file" &&
      /^\/flurryhr_test(?:_[a-z0-9]+)*$/i.test(
        new URL(process.env.DATABASE_URL || "postgresql://invalid/invalid")
          .pathname,
      )
    )
      res.setHeader("X-FlurryHR-Test-Environment", "isolated-file-mail");
    const requestId = randomUUID(),
      started = Date.now();
    res.setHeader("X-Request-ID", requestId);
    res.on("finish", () => {
      if (res.statusCode >= 500)
        console.error(
          JSON.stringify({
            event: "http.error",
            requestId,
            method: req.method,
            status: res.statusCode,
            durationMs: Date.now() - started,
          }),
        );
    });
    next();
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new Errors());
  app.enableShutdownHooks();
  await app.listen(
    Number(process.env.PORT) || 4000,
    process.env.API_HOST || "127.0.0.1",
  );
}
bootstrap().catch(() => {
  console.error(
    JSON.stringify({
      event: "startup.failed",
      message:
        "Check database, migrations, environment configuration and port availability.",
    }),
  );
  process.exit(1);
});
