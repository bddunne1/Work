// Copied from src/lib/permissions.ts PERMISSION_PRESETS.
export const PRESETS = {
  "order-entry": { "order-entry": "edit", "pick-pack": "edit", bol: "edit", customers: "view", catalog: "view", inventory: "view", schedule: "view", "order-detail": "view", "open-orders": "view", "closed-orders": "view", analytics: "view" },
  warehouse: { "pick-pack": "edit", "open-picks": "edit", "warehouse-capacity": "view", schedule: "edit", bol: "edit", labels: "edit", "shipment-history": "view", "back-orders": "view", inventory: "view", catalog: "view", "order-detail": "view", analytics: "view" },
  "customer-service": { customers: "edit", "customer-pricing": "view", "routing-guide": "edit", "order-entry": "edit", "order-detail": "view", "open-orders": "view", "closed-orders": "view", schedule: "view", catalog: "view", analytics: "view" },
  purchasing: { inventory: "edit", catalog: "edit", "purchase-orders": "edit", receiving: "edit", vendors: "edit", import: "edit", "order-detail": "view", analytics: "view" },
  "sales-manager": { customers: "edit", "customer-pricing": "edit", "routing-guide": "edit", "order-detail": "view", "open-orders": "view", "closed-orders": "view", "back-orders": "view", schedule: "view", catalog: "view", analytics: "edit" },
};
// No preset exists for these two jobs - these are what an admin would tick
// in Accounts for them (page-level access matching the job).
export const CUSTOM = {
  validation: { validation: "edit", allocation: "edit", "back-orders": "edit", "open-orders": "view", "order-detail": "view", catalog: "view", customers: "view", inventory: "view" },
  receiving: { receiving: "edit", "purchase-orders": "view", inventory: "view", catalog: "view", vendors: "view" },
};

export const STAFF = [
  ["oe.maria", "order-entry", "Order Entry"],
  ["oe.james", "order-entry", "Order Entry"],
  ["oe.priya", "order-entry", "Order Entry"],
  ["oe.tom", "order-entry", "Order Entry"],
  ["cs.linda", "customer-service", "Customer Service"],
  ["val.derek", "validation", "Validation/Allocation"],
  ["val.sofia", "validation", "Validation/Allocation"],
  ["wh.marcus", "warehouse", "Warehouse Pick/Pack/Ship"],
  ["wh.kenji", "warehouse", "Warehouse Pick/Pack/Ship"],
  ["wh.rosa", "warehouse", "Warehouse Pick/Pack/Ship"],
  ["rcv.dan", "receiving", "Receiving"],
  ["rcv.ali", "receiving", "Receiving"],
  ["buy.grace", "purchasing", "Purchasing"],
  ["mgr.helen", "sales-manager", "Sales Manager"],
  ["adm.sam", "ADMIN", "Admin"],
];

export const PERMS = { ...PRESETS, ...CUSTOM };
