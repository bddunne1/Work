import { useEffect, useRef } from "react";
import type { Item } from "../types";

interface Props {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  onMatch: (item: Item) => void;
  catalog: Item[];
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

// A text input that inline-suggests the first matching catalog item number as
// the user types, with the suggested remainder pre-selected - so accepting it
// is just a Tab away (typing over the selection replaces it, same as
// backspacing it off), the way a spreadsheet's autocomplete works.
export default function ItemAutocompleteInput({
  id,
  value,
  onChange,
  onMatch,
  catalog,
  disabled,
  placeholder,
  className,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingSelection = useRef<[number, number] | null>(null);

  useEffect(() => {
    if (pendingSelection.current && inputRef.current) {
      const [start, end] = pendingSelection.current;
      inputRef.current.setSelectionRange(start, end);
      pendingSelection.current = null;
    }
  });

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const typed = e.target.value;
    const q = typed.trim().toLowerCase();
    if (!q) {
      onChange(typed);
      return;
    }
    const exact = catalog.find((c) => c.itemNumber.toLowerCase() === q);
    if (exact) {
      onChange(typed);
      onMatch(exact);
      return;
    }
    const suggestion = catalog.find(
      (c) => c.itemNumber.toLowerCase().startsWith(q) && c.itemNumber.length > typed.length
    );
    if (suggestion) {
      pendingSelection.current = [typed.length, suggestion.itemNumber.length];
      onChange(suggestion.itemNumber);
      onMatch(suggestion);
    } else {
      onChange(typed);
    }
  }

  return (
    <input
      ref={inputRef}
      id={id}
      className={className}
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      onChange={handleChange}
      autoComplete="off"
    />
  );
}
