import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

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

const SHOWN = 20;

// A type-to-filter picker, in the ARIA combobox pattern: the input is the
// combobox, the list a listbox, each option an option. ArrowDown/ArrowUp
// move the highlight (and open the list), Home/End jump, Enter picks the
// highlighted option, Escape closes without changing the value and Tab
// closes and moves on. Mouse and keyboard picks go through selectOption.
export default function SearchSelect({ options, value, onQueryChange, onSelect, placeholder, id }: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const reactId = useId();
  const listId = `${id ?? reactId}-listbox`;
  const optionId = (i: number) => `${listId}-option-${i}`;

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
  const shown = filtered.slice(0, SHOWN);
  const expanded = open && shown.length > 0;

  // The highlighted option stays in view as the arrows move it.
  useEffect(() => {
    if (!expanded || active < 0) return;
    document.getElementById(optionId(active))?.scrollIntoView({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, expanded]);

  function selectOption(o: SearchOption) {
    setOpen(false);
    setActive(-1);
    onSelect(o.id);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    const last = shown.length - 1;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (!expanded) {
          setOpen(true);
          setActive(0);
        } else setActive((a) => Math.min(a + 1, last));
        break;
      case "ArrowUp":
        e.preventDefault();
        if (!expanded) {
          setOpen(true);
          setActive(last);
        } else setActive((a) => Math.max(a - 1, 0));
        break;
      case "Home":
        if (!expanded) return;
        e.preventDefault();
        setActive(0);
        break;
      case "End":
        if (!expanded) return;
        e.preventDefault();
        setActive(last);
        break;
      case "Enter":
        if (!expanded || active < 0 || !shown[active]) return;
        // preventDefault also tells an enclosing form's Enter-to-next-field
        // handler to stand down, so focus stays here.
        e.preventDefault();
        selectOption(shown[active]);
        break;
      case "Escape":
        if (!open) return;
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        setActive(-1);
        break;
      case "Tab":
        setOpen(false);
        setActive(-1);
        break;
    }
  }

  return (
    <div className="search-select" ref={containerRef}>
      <input
        id={id}
        role="combobox"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={expanded && active >= 0 ? optionId(active) : undefined}
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          onQueryChange(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        autoComplete="off"
      />
      {expanded && (
        <ul className="search-select-menu" role="listbox" id={listId}>
          {shown.map((o, i) => (
            <li
              key={o.id}
              id={optionId(i)}
              role="option"
              aria-selected={i === active}
              className={i === active ? "is-active" : undefined}
              onMouseDown={(e) => {
                // Keep focus on the input while the mouse picks.
                e.preventDefault();
                selectOption(o);
              }}
            >
              <span className="ss-label">{o.label}</span>
              {o.sublabel && <span className="ss-sublabel">{o.sublabel}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
