import type { PurchaseOrder } from "../types";

const ORDERS_KEY = "erp_orders";
const SO_COUNTER_KEY = "erp_so_counter";
const SO_START = 10001;

function readOrders(): PurchaseOrder[] {
  const raw = localStorage.getItem(ORDERS_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as PurchaseOrder[];
  } catch {
    return [];
  }
}

function writeOrders(orders: PurchaseOrder[]): void {
  localStorage.setItem(ORDERS_KEY, JSON.stringify(orders));
}

export function nextSalesOrderNumber(): string {
  const raw = localStorage.getItem(SO_COUNTER_KEY);
  const current = raw ? parseInt(raw, 10) : SO_START;
  return String(current);
}

function commitSalesOrderNumber(): void {
  const raw = localStorage.getItem(SO_COUNTER_KEY);
  const current = raw ? parseInt(raw, 10) : SO_START;
  localStorage.setItem(SO_COUNTER_KEY, String(current + 1));
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
