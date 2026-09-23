// Vector recreation of the porter mascot pinned to the sidebar ribbon.
export default function PorterMascot({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 60 80" role="img" aria-label="Aamstrand porter mascot">
      <path d="M17 19 Q17 4 30 4 Q43 4 43 19 Z" fill="#14161c" />
      <ellipse cx="30" cy="19" rx="15" ry="3.5" fill="#14161c" />
      <circle cx="30" cy="28" r="9" fill="#f0bd97" />
      <path d="M18 68 Q17 37 30 37 Q43 37 42 68 Z" fill="#1c2026" />
      <path d="M25 39 L30 45 L35 39" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" />
      <path
        d="M17 55 Q12 61 17 67"
        fill="none"
        stroke="#1c2026"
        strokeWidth="5"
        strokeLinecap="round"
      />
      <path
        d="M43 55 Q48 61 43 67"
        fill="none"
        stroke="#1c2026"
        strokeWidth="5"
        strokeLinecap="round"
      />
      <path d="M16 60 Q30 47 44 60 L42 68 Q30 60 18 68 Z" fill="#c98b4a" />
      <path d="M16 60 Q30 51 44 60" fill="none" stroke="#8a5a26" strokeWidth="1.5" />
    </svg>
  );
}
