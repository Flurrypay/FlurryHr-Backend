import {
  Injectable,
  Inject,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { Db } from "./db";
@Injectable()
export class FaceRetention implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  constructor(@Inject(Db) private db: Db) {}
  onModuleInit() {
    this.timer = setInterval(() => void this.purge(), 3600000);
    this.timer.unref();
    void this.purge();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  async purge() {
    if (this.running) return;
    this.running = true;
    try {
      // No biometric images in logs. Unapproved references expire after 7 days.
      const expired = await this.db.system.faceEnrollment.updateMany({
        where: {
          status: { in: ["Pending", "Capturing"] },
          consentAt: { lt: new Date(Date.now() - 7 * 86400000) },
        },
        data: {
          status: "Expired",
          referenceEncrypted: null,
          version: { increment: 1 },
        },
      });
      await this.db.system.faceCheck.updateMany({
        where: {
          status: { in: ["Creating", "Started", "Verifying", "Verified"] },
          expiresAt: { lt: new Date() },
        },
        data: { status: "Expired" },
      });
      const deleted = await this.db.system.faceCheck.deleteMany({
        where: { createdAt: { lt: new Date(Date.now() - 90 * 86400000) } },
      });
      if (expired.count || deleted.count)
        await this.db.system.platformAudit.create({
          data: {
            actorId: "face-retention",
            action: "biometric.retention_purge",
            reason: `Expired references: ${expired.count}; removed old check metadata: ${deleted.count}`,
          },
        });
    } catch {
      console.error(JSON.stringify({ event: "biometric.retention_error" }));
    } finally {
      this.running = false;
    }
  }
}
