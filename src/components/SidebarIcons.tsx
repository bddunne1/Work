// Small line-style icons for the sidebar nav, one per shortcut. Plain
// currentColor strokes so they inherit the link's text/accent color.
import type { SVGProps } from "react";

function base(props: SVGProps<SVGSVGElement>) {
  return {
    width: 20,
    height: 20,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    ...props,
  };
}

export function DashboardIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <rect x="3.5" y="3.5" width="7.5" height="7.5" rx="1.4" />
      <rect x="13" y="3.5" width="7.5" height="4.8" rx="1.4" />
      <rect x="13" y="10.7" width="7.5" height="9.8" rx="1.4" />
      <rect x="3.5" y="13.5" width="7.5" height="7" rx="1.4" />
    </svg>
  );
}

export function CustomersIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 20c0-3.6 2.5-6 5.5-6s5.5 2.4 5.5 6" />
      <circle cx="17" cy="7.5" r="2.4" />
      <path d="M15.2 12.3c2.5.2 4.3 2.3 4.3 5.3" />
    </svg>
  );
}

export function InventoryIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M3.5 7.2 12 3l8.5 4.2v9.6L12 21l-8.5-4.2z" />
      <path d="M3.5 7.2 12 11l8.5-3.8" />
      <path d="M12 11v10" />
    </svg>
  );
}

export function CatalogIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M4.5 4.5h9a2 2 0 0 1 2 2V20l-2.6-1.7-2.7 1.7-2.7-1.7L4.5 20z" />
      <path d="M8 8.6h4" />
      <path d="M8 12h4" />
    </svg>
  );
}

export function AnalyticsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M3.5 20.5h17" />
      <rect x="5.5" y="12.5" width="3.6" height="6.3" rx="0.8" />
      <rect x="10.2" y="7.8" width="3.6" height="11" rx="0.8" />
      <rect x="14.9" y="4" width="3.6" height="14.8" rx="0.8" />
    </svg>
  );
}

// Customers hub cards (see CustomersHub.tsx) - one per destination page.

export function CustomerListIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <rect x="4" y="3.5" width="16" height="17" rx="1.8" />
      <path d="M7.8 8.4h8.4" />
      <path d="M7.8 12h8.4" />
      <path d="M7.8 15.6h5.4" />
    </svg>
  );
}

export function PricingIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M12.6 3.5h5.7a1.2 1.2 0 0 1 1.2 1.2v5.7a1.2 1.2 0 0 1-.35.85l-9 9a1.2 1.2 0 0 1-1.7 0l-5.65-5.65a1.2 1.2 0 0 1 0-1.7l9-9a1.2 1.2 0 0 1 .8-.35Z" />
      <circle cx="16.3" cy="7.7" r="1.3" />
    </svg>
  );
}

export function RoutingIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <circle cx="5.5" cy="6" r="2.2" />
      <path d="M5.5 8.2v3a3 3 0 0 0 3 3h5a3 3 0 0 1 3 3v1" />
      <path d="M14.3 20.4 16.5 18.2 18.7 20.4" />
      <circle cx="18.5" cy="16.2" r="1.6" />
    </svg>
  );
}

// Overflow ("more") menu trigger - three horizontal lines, opened from the
// topbar on every screen (see Layout.tsx).
export function MenuIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M4 6.5h16" />
      <path d="M4 12h16" />
      <path d="M4 17.5h16" />
    </svg>
  );
}

// Dashboard module-card icons, one per lane module (see Dashboard.tsx).

export function OrderEntryIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M6 3.5h7l4 4V20a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" />
      <path d="M13 3.5V8h4" />
      <path d="M9.5 13.5h5" />
      <path d="M12 11v5" />
    </svg>
  );
}

export function ValidationIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <rect x="5" y="4" width="14" height="17" rx="1.6" />
      <path d="M9 3.5h6a1 1 0 0 1 1 1v1H8v-1a1 1 0 0 1 1-1Z" />
      <path d="M8.5 13.5l2 2 4-4.5" />
    </svg>
  );
}

export function AllocationIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M4 7.5 12 3.8l8 3.7v8.9L12 20.2 4 16.4z" />
      <path d="M4 7.5 12 11l8-3.5" />
      <path d="M12 11v9.2" />
      <path d="M9 14l2 2 3.5-3.5" />
    </svg>
  );
}

export function BackOrderIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  );
}

export function LabelsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <rect x="4" y="9" width="16" height="8" rx="1.4" />
      <path d="M7 9V4.5h10V9" />
      <rect x="8" y="14.5" width="8" height="5" rx="0.8" />
    </svg>
  );
}

export function ReturnsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M6 9h8a5 5 0 0 1 5 5v1" />
      <path d="M10 5 6 9l4 4" />
    </svg>
  );
}

export function PickPackIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <rect x="4.5" y="8" width="15" height="12" rx="1.4" />
      <path d="M4.5 8 12 4l7.5 4" />
      <path d="M9 13.5l2 2 4-4" />
    </svg>
  );
}

export function OpenPicksIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <rect x="4.5" y="10" width="15" height="10" rx="1.2" />
      <path d="M4.5 10 7 5.5" />
      <path d="M19.5 10 17 5.5" />
      <path d="M7 5.5h10" />
    </svg>
  );
}

export function WarehouseIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M3.5 10.5 12 4l8.5 6.5V20a1 1 0 0 1-1 1h-14a1 1 0 0 1-1-1z" />
      <path d="M9 21v-7h6v7" />
    </svg>
  );
}

export function ScheduleIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <rect x="4" y="5" width="16" height="15" rx="1.6" />
      <path d="M4 9.5h16" />
      <path d="M8 3v4" />
      <path d="M16 3v4" />
    </svg>
  );
}

export function BolIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <rect x="2.5" y="8" width="10" height="7" rx="1" />
      <path d="M12.5 10.5h3.5l2.5 3v1.5h-6z" />
      <circle cx="6" cy="17.5" r="1.6" />
      <circle cx="15.5" cy="17.5" r="1.6" />
    </svg>
  );
}

export function ShipmentHistoryIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <rect x="5" y="3.5" width="14" height="17" rx="1.4" />
      <path d="M8.5 12l2.3 2.3L16 9.5" />
      <path d="M8 17h5" />
    </svg>
  );
}

export function PurchaseOrdersIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <rect x="4" y="4.5" width="10" height="14" rx="1.2" />
      <path d="M7 9h4" />
      <path d="M7 12.5h4" />
      <path d="M15 9.5h4.5" />
      <path d="M17 7.2 19.8 9.5 17 11.8" />
    </svg>
  );
}

export function ReceivingIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M4 12V6.5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1V12" />
      <path d="M4 12h5l1.5 2.5h3L15 12h5" />
      <path d="M4 12v6.5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V12" />
    </svg>
  );
}

export function VendorsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M4 9.5 5 4h14l1 5.5" />
      <path d="M4 9.5a2.3 2.3 0 0 0 4.4 1 2.3 2.3 0 0 0 4.4 0 2.3 2.3 0 0 0 4.4 0 2.3 2.3 0 0 0 4.4-1" />
      <path d="M5.5 11v9h13v-9" />
      <path d="M10 20v-5h4v5" />
    </svg>
  );
}

export function AccountsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <circle cx="10" cy="8" r="3.3" />
      <path d="M4 20c0-3.8 2.7-6.2 6-6.2s6 2.4 6 6.2" />
      <circle cx="18" cy="16" r="2" />
      <path d="M18 18v2.3" />
      <path d="M18 20.3h1.6" />
    </svg>
  );
}

export function SettingsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.5v2.3M12 18.2v2.3M4.9 6.9l1.6 1.6M17.5 15.5l1.6 1.6M3.5 12h2.3M18.2 12h2.3M4.9 17.1l1.6-1.6M17.5 8.5l1.6-1.6" />
    </svg>
  );
}

export function ActivityLogIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M4 5.5h11" />
      <path d="M4 10h7" />
      <path d="M4 14.5h5" />
      <circle cx="17" cy="16" r="4" />
      <path d="M17 14v2l1.4 1" />
    </svg>
  );
}
