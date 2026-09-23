// Vector recreation of the full Aamstrand Ropes & Twines lockup: the
// porter mascot on a rope coil, beside the wordmark, so it stays crisp
// at any size instead of the low-resolution scan it's based on.
export default function AamstrandLogo({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 420 110"
      role="img"
      aria-label="Aamstrand Ropes and Twines"
    >
      <rect x="3" y="3" width="414" height="104" rx="8" fill="#ffffff" stroke="#14161c" strokeWidth="4" />

      {/* porter mascot */}
      <g transform="translate(10, 6) scale(0.92)">
        <ellipse cx="46" cy="80" rx="30" ry="10" fill="none" stroke="#b9812f" strokeWidth="3" />
        <ellipse cx="46" cy="74" rx="24" ry="8" fill="none" stroke="#c9974a" strokeWidth="3" />
        <ellipse cx="46" cy="68" rx="18" ry="6.5" fill="none" stroke="#b9812f" strokeWidth="3" />
        <path d="M39 50 L36 68" stroke="#14161c" strokeWidth="6" strokeLinecap="round" />
        <path d="M53 50 L56 68" stroke="#14161c" strokeWidth="6" strokeLinecap="round" />
        <path d="M32 50 Q31 28 46 28 Q61 28 60 50 Z" fill="#ffffff" stroke="#14161c" strokeWidth="1.5" />
        <path d="M43 30 L46 36 L49 30 L47 49 L46 52 L45 49 Z" fill="#14161c" />
        <path d="M40 29 L46 36 L52 29" fill="none" stroke="#14161c" strokeWidth="2" strokeLinecap="round" />
        <path d="M32 36 Q23 39 26 50 Q28 54 34 52" fill="#ffffff" stroke="#14161c" strokeWidth="1.5" />
        <path d="M60 36 Q69 39 66 50 Q64 54 58 52" fill="#ffffff" stroke="#14161c" strokeWidth="1.5" />
        <circle cx="46" cy="17" r="10" fill="#f0bd97" />
        <path
          d="M36 15 Q36 6 46 6 Q56 6 56 15 Q50 10 46 10 Q42 10 36 15 Z"
          fill="#2a2320"
        />
      </g>

      <text
        x="255"
        y="58"
        textAnchor="middle"
        fontFamily="Arial, 'Helvetica Neue', sans-serif"
        fontWeight="900"
        fontStyle="italic"
        fontSize="38"
        fill="#1b3f9c"
        letterSpacing="-1"
      >
        AAMSTRAND
      </text>
      <text x="393" y="28" textAnchor="middle" fontSize="13" fontWeight="700" fill="#1b3f9c">
        &reg;
      </text>
      <rect x="106" y="70" width="292" height="24" fill="#14161c" />
      <rect x="109.5" y="73.5" width="285" height="17" fill="none" stroke="#ffffff" strokeWidth="1.2" />
      <text
        x="252"
        y="87"
        textAnchor="middle"
        fontFamily="Arial, 'Helvetica Neue', sans-serif"
        fontWeight="700"
        fontSize="13"
        fill="#ffffff"
        letterSpacing="2.5"
      >
        ROPES AND TWINES
      </text>
    </svg>
  );
}
