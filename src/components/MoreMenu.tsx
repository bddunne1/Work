import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { MenuIcon } from "./SidebarIcons";
import type { Account } from "../lib/authStore";
import { getAccessLevel } from "../lib/permissions";

// A place to stash pages that don't need a permanent spot on the sidebar or
// Dashboard - opened from the topbar so it's reachable from any screen.
const MORE_MENU_ITEMS = [
  { name: "Reports", to: "/reports" },
  { name: "Import Data", to: "/import" },
];

interface Props {
  account: Account;
}

export default function MoreMenu({ account }: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const items = MORE_MENU_ITEMS.filter((m) => getAccessLevel(m.to, account) !== "none");
  if (items.length === 0) return null;

  return (
    <div className="more-menu" ref={containerRef}>
      <button
        type="button"
        className="more-menu-btn"
        aria-label="More"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <MenuIcon />
      </button>
      {open && (
        <div className="more-menu-panel">
          {items.map((m) => (
            <Link key={m.to} to={m.to} className="more-menu-item" onClick={() => setOpen(false)}>
              {m.name}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
