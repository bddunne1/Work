import { useLayoutEffect, type RefObject } from "react";

// Sizes a scrolling list to the window instead of a fixed pixel cap.
//
// Measures where the element sits (its distance from the top of the
// viewport, i.e. the header, page header and toolbar above it) and writes it
// as `--chrome-height` on the element, so CSS can say
// `max-height: calc(100dvh - var(--chrome-height))` and the list reaches the
// bottom of the window on a 16:9 desktop while still scrolling inside the
// page on a tall or narrow display. `reserve` is the room to leave below the
// list (a pager, a button row, the page's bottom gutter).
//
// Re-measured on resize and whenever anything above it changes size (a
// toolbar wrapping to two lines, a banner appearing), through a
// ResizeObserver on the page.
export function useViewportHeight<T extends HTMLElement>(ref: RefObject<T | null>, reserve = 24, deps: unknown[] = []): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const node = ref.current;
      if (!node) return;
      // Distance from the top of the viewport, as if the page were scrolled
      // to the top: the list is what should scroll, not the page.
      const top = node.getBoundingClientRect().top + window.scrollY;
      node.style.setProperty("--chrome-height", `${Math.max(0, Math.round(top + reserve))}px`);
    };
    const schedule = () => {
      if (frame === 0) frame = window.requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("resize", schedule);
    const page = el.closest(".page") ?? el.parentElement;
    const observer = typeof ResizeObserver !== "undefined" && page ? new ResizeObserver(schedule) : null;
    if (observer && page) observer.observe(page);
    return () => {
      window.removeEventListener("resize", schedule);
      observer?.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, reserve, ...deps]);
}
