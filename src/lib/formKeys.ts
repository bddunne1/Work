import type { KeyboardEvent } from "react";

// Enter in a text field moves to the next field instead of submitting the
// form (R4-15): on Order Entry, the PO form and the RA form, Enter used to
// save the whole document from whatever cell the cursor was in. A picker
// that handles Enter itself (and calls preventDefault) is left alone; the
// Save button and textareas keep their normal behaviour.
export function moveOnEnter(e: KeyboardEvent<HTMLFormElement>): void {
  if (e.key !== "Enter" || e.defaultPrevented) return;
  const target = e.target as HTMLElement;
  if (!(target instanceof HTMLInputElement)) return;
  if (["submit", "button", "checkbox", "radio"].includes(target.type)) return;
  e.preventDefault();
  const fields = Array.from(
    e.currentTarget.querySelectorAll<HTMLElement>("input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled])")
  );
  const next = fields[fields.indexOf(target) + 1];
  if (!next) return;
  next.focus();
  if (next instanceof HTMLInputElement && !["date", "checkbox", "radio"].includes(next.type)) next.select();
}
