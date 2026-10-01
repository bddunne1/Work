-- Cancelling an order whose pick list or packing slip has printed leaves a
-- pull-from-floor task for the warehouse (sprint 2, A-23): requested at
-- cancel, acknowledged from Open Picks.
ALTER TABLE "SalesOrder" ADD COLUMN "pullRequestedAt" TIMESTAMP(3),
                         ADD COLUMN "pullAcknowledgedAt" TIMESTAMP(3);
