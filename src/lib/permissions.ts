import type { Role } from "./authStore";

export type AccessLevel = "edit" | "view" | "none";

// Order-entry access, most specific path first since matching stops at the
// first rule whose prefix the current path starts with. Admin always gets
// "edit" everywhere and never consults this table.
const ORDER_ENTRY_RULES: { prefix: string; access: AccessLevel }[] = [
  { prefix: "/login", access: "view" },
  { prefix: "/order-entry", access: "edit" },
  { prefix: "/pick-pack", access: "edit" },
  { prefix: "/customers/new", access: "none" },
  { prefix: "/customers", access: "view" }, // list and .../:id detail+edit (CustomerEditor is read-only when !canEdit)
  { prefix: "/items/new", access: "none" },
  { prefix: "/items/", access: "none" }, // .../:id/edit
  { prefix: "/items", access: "view" },
  { prefix: "/schedule", access: "view" },
  { prefix: "/storage", access: "view" },
  { prefix: "/open-orders", access: "view" },
  { prefix: "/closed-orders", access: "view" },
];

export function getAccessLevel(pathname: string, role: Role): AccessLevel {
  if (role === "admin") return "edit";
  if (pathname === "/") return "view";
  const rule = ORDER_ENTRY_RULES.find((r) => pathname.startsWith(r.prefix));
  return rule?.access ?? "none";
}

export function canView(pathname: string, role: Role): boolean {
  return getAccessLevel(pathname, role) !== "none";
}

export function canEdit(pathname: string, role: Role): boolean {
  return getAccessLevel(pathname, role) === "edit";
}
