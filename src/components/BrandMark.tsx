// The Splice mark: two crossing strokes, one in Ink (or Paper on a dark
// tile) and one in Signal orange, with the orange stroke passing over the
// other. `tile` picks the background it sits on, as on the brand sheet:
// the Ink app tile (default, the sidebar), the Signal tile, or no tile at
// all for the mark beside the wordmark.
const INK = "#14181F";
const SIGNAL = "#FF5A2C";
const PAPER = "#FBFAF7";

interface Props {
  className?: string;
  tile?: "ink" | "signal" | "none";
}

export default function BrandMark({ className, tile = "ink" }: Props) {
  const under = tile === "signal" ? PAPER : tile === "ink" ? PAPER : "currentColor";
  const over = tile === "signal" ? INK : SIGNAL;
  const halo = tile === "signal" ? SIGNAL : tile === "ink" ? INK : "var(--panel-bg)";
  return (
    <svg className={className} viewBox="0 0 64 64" role="img" aria-label="Splice">
      {tile !== "none" && <rect x="0" y="0" width="64" height="64" rx="16" fill={tile === "signal" ? SIGNAL : INK} />}
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 19 C 26 19, 38 45, 50 45" stroke={under} strokeWidth="7.5" />
        <path d="M14 45 C 26 45, 38 19, 50 19" stroke={halo} strokeWidth="12.5" />
        <path d="M14 45 C 26 45, 38 19, 50 19" stroke={over} strokeWidth="7.5" />
      </g>
    </svg>
  );
}

// The wordmark, set in Sora Bold (loaded in index.html).
export function Wordmark({ className }: { className?: string }) {
  return <span className={`wordmark ${className ?? ""}`.trim()}>Splice</span>;
}
