// Vector recreation of the Aamstrand Ropes & Twines wordmark, so it stays
// crisp at any size instead of the low-resolution scan it's based on.
export default function AamstrandLogo({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 320 100"
      role="img"
      aria-label="Aamstrand Ropes and Twines"
    >
      <rect x="3" y="3" width="314" height="94" rx="8" fill="#ffffff" stroke="#14161c" strokeWidth="4" />
      <text
        x="152"
        y="54"
        textAnchor="middle"
        fontFamily="Arial, 'Helvetica Neue', sans-serif"
        fontWeight="900"
        fontStyle="italic"
        fontSize="40"
        fill="#1b3f9c"
        letterSpacing="-1"
      >
        AAMSTRAND
      </text>
      <text x="300" y="26" textAnchor="middle" fontSize="14" fontWeight="700" fill="#1b3f9c">
        &reg;
      </text>
      <rect x="14" y="66" width="292" height="24" fill="#14161c" />
      <rect x="17.5" y="69.5" width="285" height="17" fill="none" stroke="#ffffff" strokeWidth="1.2" />
      <text
        x="160"
        y="83"
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
