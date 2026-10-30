import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";

// Where a page's Back link goes. A page reached in-app (the router has a
// history entry behind it) goes back to wherever the person came from -
// the queue, the dashboard, a customer, a PO; a page opened from a link or
// a bookmark, with nothing behind it, goes to `fallback` (its parent list).
export function useBackTarget(fallback: string): { canGoBack: boolean; goBack: () => void; fallback: string } {
  const navigate = useNavigate();
  const location = useLocation();
  const idx = typeof window !== "undefined" ? ((window.history.state as { idx?: number } | null)?.idx ?? 0) : 0;
  const canGoBack = location.key !== "default" && idx > 0;
  const goBack = useCallback(() => {
    if (canGoBack) navigate(-1);
    else navigate(fallback);
  }, [canGoBack, navigate, fallback]);
  return { canGoBack, goBack, fallback };
}
