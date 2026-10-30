import { useRef, type ReactNode } from "react";
import { useViewportHeight } from "../lib/useViewportHeight";

interface Props {
  children: ReactNode;
  className?: string;
  // Room to leave under the list: 24px gutter by default; more when a pager
  // or a button row follows the list.
  reserve?: number;
}

// A `.scroll-window` that fills the viewport below the page chrome (see
// useViewportHeight) rather than stopping at a fixed pixel height: the
// list is the thing that fills the screen on every list page.
export default function ListWindow({ children, className, reserve = 24 }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useViewportHeight(ref, reserve);
  return (
    <div ref={ref} className={`scroll-window list-fill${className ? ` ${className}` : ""}`}>
      {children}
    </div>
  );
}
