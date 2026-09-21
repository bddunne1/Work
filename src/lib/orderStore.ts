import type { PurchaseOrder } from "../types";

const ORDERS_KEY = "erp_orders";
const SO_COUNTER_KEY = "erp_so_counter";
const SO_START = 10001;

function readOrders(): PurchaseOrder[] {
  try {
    const raw = localStorage.getItem(ORDERS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as PurchaseOrder[];
  } catch {
    return [];
  }
}

function writeOrders(orders: PurchaseOrder[]): void {
  try {
    localStorage.setItem(ORDERS_KEY, JSON.stringify(orders));
  } catch {
    // storage unavailable (private mode, blocked site data, etc.) - no-op
  }
}

export function nextSalesOrderNumber(): string {
  try {
    const raw = localStorage.getItem(SO_COUNTER_KEY);
    const current = raw ? parseInt(raw, 10) : SO_START;
    return String(current);
  } catch {
    return String(SO_START);
  }
}

function commitSalesOrderNumber(): void {
  try {
    const raw = localStorage.getItem(SO_COUNTER_KEY);
    const current = raw ? parseInt(raw, 10) : SO_START;
    localStorage.setItem(SO_COUNTER_KEY, String(current + 1));
  } catch {
    // storage unavailable - no-op
  }
}

export function listOrders(): PurchaseOrder[] {
  return readOrders().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getOrder(soNumber: string): PurchaseOrder | undefined {
  return readOrders().find((o) => o.soNumber === soNumber);
}

export function saveOrder(order: PurchaseOrder): void {
  const orders = readOrders();
  orders.push(order);
  writeOrders(orders);
  commitSalesOrderNumber();
}

export function updateOrder(order: PurchaseOrder): void {
  const orders = readOrders().map((o) => (o.soNumber === order.soNumber ? order : o));
  writeOrders(orders);
}
