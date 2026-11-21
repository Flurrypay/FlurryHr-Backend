-- Match the tenant/parent predicate and the complete deterministic page order.
CREATE INDEX "Candidate_parent_page_idx" ON "Candidate" ("organizationId", "jobId", "createdAt" DESC, "id" ASC);
CREATE INDEX "TaskEvent_parent_page_idx" ON "TaskEvent" ("organizationId", "taskId", "createdAt" ASC, "id" ASC);
CREATE INDEX "AssetHistory_parent_page_idx" ON "AssetHistory" ("organizationId", "assetId", "createdAt" DESC, "id" ASC);
CREATE INDEX "Employee_name_page_idx" ON "Employee" ("organizationId", "firstName" ASC, "id" ASC);
