// Vector recreation of the Aamstrand porter mascot: white shirt, black
// tie, dark trousers, standing on a coil of rope.
export default function PorterMascot({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 60 84" role="img" aria-label="Aamstrand porter mascot">
      {/* rope coil base */}
      <ellipse cx="30" cy="72" rx="26" ry="9" fill="none" stroke="#b9812f" strokeWidth="3" />
      <ellipse cx="30" cy="67" rx="21" ry="7.5" fill="none" stroke="#c9974a" strokeWidth="3" />
      <ellipse cx="30" cy="62.5" rx="16" ry="6" fill="none" stroke="#b9812f" strokeWidth="3" />

      {/* legs */}
      <path d="M24 46 L21 62" stroke="#14161c" strokeWidth="6" strokeLinecap="round" />
      <path d="M36 46 L39 62" stroke="#14161c" strokeWidth="6" strokeLinecap="round" />

      {/* torso (shirt) */}
      <path d="M18 46 Q17 26 30 26 Q43 26 42 46 Z" fill="#ffffff" stroke="#14161c" strokeWidth="1.5" />

      {/* tie */}
      <path d="M27 28 L30 33 L33 28 L31 45 L30 48 L29 45 Z" fill="#14161c" />

      {/* collar */}
      <path d="M24 27 L30 33 L36 27" fill="none" stroke="#14161c" strokeWidth="2" strokeLinecap="round" />

      {/* arms akimbo */}
      <path
        d="M18 33 Q10 36 13 46 Q15 50 20 48"
        fill="#ffffff"
        stroke="#14161c"
        strokeWidth="1.5"
      />
      <path
        d="M42 33 Q50 36 47 46 Q45 50 40 48"
        fill="#ffffff"
        stroke="#14161c"
        strokeWidth="1.5"
      />

      {/* head + hair */}
      <circle cx="30" cy="16" r="9" fill="#f0bd97" />
      <path d="M21 14 Q21 6 30 6 Q39 6 39 14 Q34 10 30 10 Q26 10 21 14 Z" fill="#2a2320" />
    </svg>
  );
}
