import { useEffect, useRef, type RefObject } from "react";

// Focus handling for anything that opens over or inside a page - a drawer,
// a menu, an inline panel. While `open`: focus moves into the container
// (its first focusable element, or the container itself), Escape calls
// `onClose`, and with `trap` Tab and Shift+Tab stay inside. When it closes
// or unmounts, focus returns to whatever opened it.
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
}

export function useDismissable<T extends HTMLElement>(open: boolean, onClose: () => void, opts: { trap?: boolean } = {}): RefObject<T | null> {
  const ref = useRef<T | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  const { trap = false } = opts;

  useEffect(() => {
    if (!open) return;
    const container = ref.current;
    if (!container) return;
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!container.contains(document.activeElement)) {
      const first = focusables(container)[0];
      if (first) first.focus();
      else {
        if (!container.hasAttribute("tabindex")) container.setAttribute("tabindex", "-1");
        container.focus();
      }
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented) return;
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (trap && e.key === "Tab" && container) {
        const items = focusables(container);
        if (items.length === 0) {
          e.preventDefault();
          return;
        }
        const first = items[0];
        const last = items[items.length - 1];
        const current = document.activeElement;
        if (e.shiftKey && (current === first || !container.contains(current))) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (current === last || !container.contains(current))) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      const opener = openerRef.current;
      openerRef.current = null;
      // Give focus back only if it is still inside what is closing (or was
      // lost with it), so a click elsewhere keeps its own focus.
      const active = document.activeElement;
      const lost = !active || active === document.body || container.contains(active);
      if (lost && opener && opener.isConnected) opener.focus();
    };
  }, [open, trap]);

  return ref;
}
