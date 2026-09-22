import { useEffect, useRef, useState } from "react";

export interface SearchOption {
  id: string;
  label: string;
  sublabel?: string;
}

interface Props {
  options: SearchOption[];
  value: string;
  onQueryChange: (query: string) => void;
  onSelect: (id: string) => void;
  placeholder?: string;
  id?: string;
}

export default function SearchSelect({ options, value, onQueryChange, onSelect, placeholder, id }: Props) {
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

  const query = value.trim().toLowerCase();
  const filtered = query
    ? options.filter(
        (o) => o.label.toLowerCase().includes(query) || (o.sublabel ?? "").toLowerCase().includes(query)
      )
    : options;

  function select(o: SearchOption) {
    setOpen(false);
    onSelect(o.id);
  }

  return (
    <div className="search-select" ref={containerRef}>
      <input
        id={id}
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          onQueryChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        autoComplete="off"
      />
      {open && filtered.length > 0 && (
        <ul className="search-select-menu">
          {filtered.slice(0, 20).map((o) => (
            <li key={o.id} onMouseDown={() => select(o)}>
              <span className="ss-label">{o.label}</span>
              {o.sublabel && <span className="ss-sublabel">{o.sublabel}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
