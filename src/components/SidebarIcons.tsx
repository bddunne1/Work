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
