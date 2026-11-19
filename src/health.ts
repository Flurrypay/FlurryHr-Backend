import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Db } from "./db";
@Controller("health")
export class HealthController {
  constructor(@Inject(Db) private db: Db) {}
  @Get() async health() {
    try {
      await this.db.system.$queryRaw`SELECT 1`;
      return { status: "ok" };
    } catch {
      throw new ServiceUnavailableException("Database unavailable");
    }
  }
}
