-- Sprint 5: three customer-pays flags on a return authorization. Billing
-- decisions for Accounting; nothing here touches stock or the credit memo.
ALTER TABLE "ReturnAuthorization" ADD COLUMN "customerPaysReturnFreight" BOOLEAN NOT NULL DEFAULT false,
                                  ADD COLUMN "customerPaysRestockingFee" BOOLEAN NOT NULL DEFAULT false,
                                  ADD COLUMN "customerPaysOriginalFreight" BOOLEAN NOT NULL DEFAULT false;
