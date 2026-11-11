import type { KeyboardEvent } from "react";

// Keyboard activation for a table row whose click opens a page but whose
// cells carry no control going there (the queue rows open a decision page
// while their S.O. # link opens the order). The row joins the tab order
// and Enter or Space does what a click does; keys on controls inside the
// row (links, checkboxes) are left to them.
export function rowKeyboardProps(activate: () => void, label: string) {
  return {
    tabIndex: 0,
    role: "button" as const,
    "aria-label": label,
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (e.target !== e.currentTarget) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        activate();
      }
    },
  };
}
