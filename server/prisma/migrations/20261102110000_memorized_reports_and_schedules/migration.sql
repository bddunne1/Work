-- Sprint 6: memorized reports carry a spec, an owner, a shared flag and a
-- group; report groups can be scheduled by email. The old dataSourceKey /
-- filters / columns stay (nullable) for one release; the server back-fills
-- `spec` from them at start-up.
ALTER TABLE "SavedReport" ALTER COLUMN "dataSourceKey" DROP NOT NULL,
                          ALTER COLUMN "filters" DROP NOT NULL,
                          ALTER COLUMN "columns" DROP NOT NULL,
                          ADD COLUMN "spec" JSONB,
                          ADD COLUMN "ownerId" TEXT,
                          ADD COLUMN "shared" BOOLEAN NOT NULL DEFAULT true,
                          ADD COLUMN "groupName" TEXT,
                          ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "SavedReport_ownerId_idx" ON "SavedReport"("ownerId");
CREATE INDEX "SavedReport_groupName_idx" ON "SavedReport"("groupName");

CREATE TABLE "ReportSchedule" (
    "id" TEXT NOT NULL,
    "groupName" TEXT NOT NULL,
    "cron" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "recipients" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdById" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportSchedule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ReportSchedule_active_idx" ON "ReportSchedule"("active");
