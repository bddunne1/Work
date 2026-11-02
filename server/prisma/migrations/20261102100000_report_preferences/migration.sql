-- Sprint 6: the Report Center's per-account favorites and recent reports.
CREATE TABLE "ReportPreference" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "reportRef" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportPreference_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ReportPreference_accountId_idx" ON "ReportPreference"("accountId");
CREATE UNIQUE INDEX "ReportPreference_accountId_reportRef_kind_key" ON "ReportPreference"("accountId", "reportRef", "kind");

ALTER TABLE "ReportPreference" ADD CONSTRAINT "ReportPreference_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
