export function Logo({ size = 40 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      xmlns="http://www.w3.org/2000/svg"
      className="drop-shadow-[0_0_8px_#39FF14]"
    >
      <circle
        cx="24"
        cy="24"
        r="22"
        fill="none"
        stroke="#39FF14"
        strokeWidth="1.5"
        opacity="0.4"
      />
      <path
        d="M 8 32 L 10 22 Q 12 18 18 18 L 28 18 Q 34 18 36 22 L 40 32 L 40 36 L 8 36 Z"
        fill="none"
        stroke="#39FF14"
        strokeWidth="2.2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M 15 26 L 17 22 L 21 22 L 21 26 Z" fill="#39FF14" opacity="0.6" />
      <path d="M 25 22 L 29 22 L 32 26 L 25 26 Z" fill="#39FF14" opacity="0.6" />
      <circle cx="15" cy="37" r="3" fill="#0a0a0a" stroke="#39FF14" strokeWidth="1.8" />
      <circle cx="33" cy="37" r="3" fill="#0a0a0a" stroke="#39FF14" strokeWidth="1.8" />
      <circle cx="39" cy="29" r="1.2" fill="#39FF14" />
    </svg>
  );
}