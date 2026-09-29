import { useEffect, useState } from "react";
import { dismissToast, subscribeToasts, type Toast } from "../lib/toast";

// Renders the toasts queued through lib/toast.ts (C-01). Mounted once, in Layout.
export default function ToastHost() {
  const [list, setList] = useState<Toast[]>([]);
  useEffect(() => subscribeToasts(setList), []);
  if (list.length === 0) return null;
  return (
    <div className="toast-host" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          <span className="toast-text">{t.message}</span>
          <button type="button" className="toast-close" aria-label="Dismiss" onClick={() => dismissToast(t.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
