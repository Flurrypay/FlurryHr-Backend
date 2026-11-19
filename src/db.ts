import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  ForbiddenException,
} from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { AsyncLocalStorage } from "node:async_hooks";
export const tenantContext = new AsyncLocalStorage<{
  organizationId?: string;
}>();
export const tenantModels = new Set([
  "Department",
  "Schedule",
  "Holiday",
  "Employee",
  "Attendance",
  "Correction",
  "LeaveType",
  "LeaveAllocation",
  "LeaveRequest",
  "Job",
  "Candidate",
  "OnboardingItem",
  "Task",
  "Payroll",
  "Announcement",
  "Audit",
  "Notification",
  "TaskEvent",
  "Document",
  "Asset",
  "AssetHistory",
  "PerformanceReview",
  "Invitation",
]);
@Injectable()
export class Db implements OnModuleInit, OnModuleDestroy {
  // Identity, registration, delivery and aggregate platform operations only.
  // Tenant controllers use the fail-closed inherited client, never this bypass.
  readonly system = new PrismaClient();
  private readonly tenant = this.system.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!tenantModels.has(model)) return query(args);
          const organizationId = tenantContext.getStore()?.organizationId;
          if (!organizationId)
            throw new ForbiddenException(
              "An active company workspace is required",
            );
          // The dynamic query extension preserves each public Prisma delegate's generated types.
          const scoped = args as Record<string, any>;
          if (
            [
              "findMany",
              "findFirst",
              "findFirstOrThrow",
              "findUnique",
              "findUniqueOrThrow",
              "count",
              "aggregate",
              "groupBy",
              "update",
              "updateMany",
              "delete",
              "deleteMany",
              "upsert",
            ].includes(operation)
          )
            scoped.where = { ...scoped.where, organizationId };
          if (operation === "create")
            scoped.data = { ...scoped.data, organizationId };
          if (operation === "createMany")
            scoped.data = (
              Array.isArray(scoped.data) ? scoped.data : [scoped.data]
            ).map((data: Record<string, unknown>) => ({
              ...data,
              organizationId,
            }));
          if (operation === "upsert")
            scoped.create = { ...scoped.create, organizationId };
          for (const key of ["data", "update"])
            if (
              scoped[key] &&
              !Array.isArray(scoped[key]) &&
              ["update", "updateMany", "upsert"].includes(operation)
            ) {
              delete scoped[key].organization;
              delete scoped[key].organizationId;
            }
          return query(args);
        },
      },
    },
  });
  readonly $transaction = this.tenant.$transaction.bind(
    this.tenant,
  ) as PrismaClient["$transaction"];
  get user() {
    return this.tenant.user;
  }
  get session() {
    return this.tenant.session;
  }
  get department() {
    return this.tenant.department;
  }
  get schedule() {
    return this.tenant.schedule;
  }
  get holiday() {
    return this.tenant.holiday;
  }
  get employee() {
    return this.tenant.employee;
  }
  get attendance() {
    return this.tenant.attendance;
  }
  get correction() {
    return this.tenant.correction;
  }
  get leaveType() {
    return this.tenant.leaveType;
  }
  get leaveAllocation() {
    return this.tenant.leaveAllocation;
  }
  get leaveRequest() {
    return this.tenant.leaveRequest;
  }
  get job() {
    return this.tenant.job;
  }
  get candidate() {
    return this.tenant.candidate;
  }
  get onboardingItem() {
    return this.tenant.onboardingItem;
  }
  get task() {
    return this.tenant.task;
  }
  get payroll() {
    return this.tenant.payroll;
  }
  get announcement() {
    return this.tenant.announcement;
  }
  get audit() {
    return this.tenant.audit;
  }
  get membership() {
    return this.tenant.membership;
  }
  get invitation() {
    return this.tenant.invitation;
  }
  get notification() {
    return this.tenant.notification;
  }
  get taskEvent() {
    return this.tenant.taskEvent;
  }
  get document() {
    return this.tenant.document;
  }
  get asset() {
    return this.tenant.asset;
  }
  get assetHistory() {
    return this.tenant.assetHistory;
  }
  get performanceReview() {
    return this.tenant.performanceReview;
  }
  async onModuleInit() {
    await this.system.$connect();
  }
  async onModuleDestroy() {
    await this.system.$disconnect();
  }
}
