import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useDismissable } from "../lib/useDismissable";
import { Link } from "react-router-dom";
import { MenuIcon } from "./SidebarIcons";
import type { Account } from "../lib/authStore";
import { getAccessLevel } from "../lib/permissions";

// A place to stash pages that don't need a permanent spot on the sidebar or
// Dashboard - opened from the topbar so it's reachable from any screen.
const MORE_MENU_ITEMS = [
  { name: "Reports", to: "/reports" },
  { name: "Import Data", to: "/import" },
  { name: "Settings", to: "/settings" },
];

interface Props {
  account: Account;
}

export default function MoreMenu({ account }: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  // Escape closes the menu and puts focus back on the button; opening moves
  // focus to the first item.
  const panelRef = useDismissable<HTMLDivElement>(open, () => setOpen(false));

  // Arrow keys walk the items; Home and End jump.
  function onPanelKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const links = [...(panelRef.current?.querySelectorAll<HTMLAnchorElement>(".more-menu-item") ?? [])];
    const i = links.indexOf(document.activeElement as HTMLAnchorElement);
    const go = (n: number) => {
      e.preventDefault();
      links[(n + links.length) % links.length]?.focus();
    };
    if (e.key === "ArrowDown") go(i + 1);
    else if (e.key === "ArrowUp") go(i - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(links.length - 1);
  }

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const items = [
    ...MORE_MENU_ITEMS.filter((m) => getAccessLevel(m.to, account) !== "none"),
    { name: "Preferences", to: "/preferences" },
    { name: "Change Password", to: "/change-password" },
  ];

  return (
    <div className="more-menu" ref={containerRef}>
      <button
        type="button"
        className="more-menu-btn"
        aria-label="More"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <MenuIcon />
      </button>
      {open && (
        <div className="more-menu-panel" role="menu" ref={panelRef} onKeyDown={onPanelKeyDown}>
          {items.map((m) => (
            <Link key={m.to} to={m.to} className="more-menu-item" role="menuitem" onClick={() => setOpen(false)}>
              {m.name}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
