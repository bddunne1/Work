# Aamstrand ERP

Framework for a purchase-order / fulfillment ERP, built around the order
workflow: PO submission → order entry → validation → inventory allocation →
pick & pack → fulfillment → shipping.

This first iteration covers the **Order Entry** and **Storage** stages.
Other stages from the workflow appear on the dashboard as placeholders to
be built out next.

## Stack

React + TypeScript + Vite, with client-side routing (react-router) and
orders persisted to `localStorage` via `src/lib/orderStore.ts`. There's no
backend yet — the store module is the seam where a real API/database can
be swapped in later without touching the pages.

## Pages

- **Dashboard** (`/`) — navigation into each stage of the order workflow,
  grouped by swimlane (Order Prep, Fulfillment, Logistics), plus a recent
  orders list.
- **Order Entry** (`/order-entry`) — enter a customer PO and generate a
  sales order: PO #, bill-to/ship-to, FOB, ship via, terms, rep, line
  items, and an auto-generated S.O. #. Modeled on the attached sample
  sales order layout.
- **Storage** (`/storage`) — browse and search previously entered orders.
- **Order Detail** (`/storage/:soNumber`) — read-only view of a stored
  order.

## Development

```bash
npm install
npm run dev      # start the dev server
npm run build    # typecheck + production build
npm run lint      # oxlint
```
