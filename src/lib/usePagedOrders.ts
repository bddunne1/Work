import { useCallback, useEffect, useState } from "react";
import { searchOrders } from "./orderStore";
import type { OrderSearchParams, OrderSearchResult } from "./orderStore";

const EMPTY: OrderSearchResult = { rows: [], total: 0, page: 1, pageSize: 0 };

// One server-side page of orders for `params` (see searchOrders), refetched
// whenever the params change or reload() is called. A response for params
// that have since changed is dropped, so fast typing can't leave an older
// page on screen; the previous page stays visible while the next loads.
export function usePagedOrders(params: OrderSearchParams) {
  const paramsKey = JSON.stringify(params);
  const [reloads, setReloads] = useState(0);
  const requestKey = `${reloads}:${paramsKey}`;
  const [state, setState] = useState<{ key: string; result: OrderSearchResult } | null>(null);

  useEffect(() => {
    let cancelled = false;
    searchOrders(JSON.parse(paramsKey) as OrderSearchParams).then((result) => {
      if (!cancelled) setState({ key: `${reloads}:${paramsKey}`, result });
    });
    return () => {
      cancelled = true;
    };
  }, [paramsKey, reloads]);

  const reload = useCallback(() => setReloads((n) => n + 1), []);

  return {
    ...(state?.result ?? EMPTY),
    loading: state?.key !== requestKey,
    loaded: state !== null,
    reload,
  };
}

// The current page number, reset to 1 whenever `filterKey` (the search
// text, filters, page size...) changes - without an extra render/fetch of
// the old page the way resetting it from an effect would.
export function usePageForFilters(filterKey: string): [number, (page: number) => void] {
  const [state, setState] = useState({ key: filterKey, page: 1 });
  const page = state.key === filterKey ? state.page : 1;
  const setPage = useCallback((p: number) => setState({ key: filterKey, page: Math.max(1, p) }), [filterKey]);
  return [page, setPage];
}
