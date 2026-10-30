import { Link } from "react-router-dom";
import { useBackTarget } from "../lib/useBackTarget";

interface Props {
  // Where to go when there is nothing to go back to (the page's parent list).
  fallback: string;
  // Names the fallback - shown only when the fallback will be used.
  label: string;
  className?: string;
}

// "← Back" to wherever the person came from, or "← Back to <label>" when the
// page was opened cold. A real link to the fallback either way, so
// middle-click and copy-link still work.
export default function BackLink({ fallback, label, className = "link-btn" }: Props) {
  const { canGoBack, goBack } = useBackTarget(fallback);
  return (
    <Link
      to={fallback}
      className={className}
      onClick={(e) => {
        if (!canGoBack || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        goBack();
      }}
    >
      &larr; {canGoBack ? "Back" : `Back to ${label}`}
    </Link>
  );
}
