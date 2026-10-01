import { useEffect, useState } from "react";
import { ApiError } from "./apiClient";
import { claimOrder, unclaimOrder } from "./orderStore";
import type { PurchaseOrder } from "../types";

// Claims an order while its decision page is open (C-08): the queues then
// show who has it and skip it for everyone else. The claim is let go when
// the page is left; a decision ends it on the server. If someone else
// already holds it, `heldBy` names them and the page should not act.
export function useClaim(order: PurchaseOrder | undefined, enabled: boolean): { heldBy: string | null } {
  const soNumber = order?.soNumber;
  const [heldBy, setHeldBy] = useState<string | null>(null);
  useEffect(() => {
    if (!soNumber || !enabled) return;
    let mine = false;
    let cancelled = false;
    claimOrder({ soNumber })
      .then(() => {
        mine = true;
        if (!cancelled) setHeldBy(null);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 409) setHeldBy((err as ApiError & { claimedBy?: string }).message.replace(/^.*reviewed by /, "").replace(/ \(until.*$/, ""));
      });
    return () => {
      cancelled = true;
      if (mine) unclaimOrder({ soNumber }).catch(() => {});
    };
  }, [soNumber, enabled]);
  return { heldBy };
}
