// The Aamstrand "A" mark - a stylized standalone monogram for the sidebar,
// echoing the italic wordmark's typography in a small gradient badge.
export default function BrandMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 64" role="img" aria-label="Aamstrand">
      <defs>
        <linearGradient id="brandMarkGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#4c7ff0" />
          <stop offset="100%" stopColor="#1b3f9c" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="16" fill="url(#brandMarkGradient)" />
      <rect x="2.75" y="2.75" width="58.5" height="58.5" rx="15.25" fill="none" stroke="rgba(255,255,255,0.28)" strokeWidth="1.5" />
      <text
        x="33"
        y="46"
        textAnchor="middle"
        fontFamily="Arial, 'Helvetica Neue', sans-serif"
        fontWeight="900"
        fontStyle="italic"
        fontSize="36"
        fill="#ffffff"
      >
        A
      </text>
    </svg>
  );
}
