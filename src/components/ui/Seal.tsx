import { cn } from "@/lib/utils";

type SealProps = {
  className?: string;
  accent?: string;
  /** Adds the outer inscription ring (used on the charter/review) */
  inscribed?: boolean;
  inscription?: string;
  subInscription?: string;
  size?: number;
};

export function Seal({
  className,
  accent = "#16324f",
  inscribed = false,
  inscription = "SMARTGOV · UNIVERSITY STUDENT GOVERNANCE ·",
  subInscription = "CHARTERED SYSTEM",
  size = 64,
}: SealProps) {
  const id = `seal-${accent.replace("#", "")}`;
  return (
    <svg
      viewBox="0 0 200 200"
      width={size}
      height={size}
      className={cn("shrink-0 overflow-visible", className)}
      role="img"
      aria-label="SmartGov seal"
    >
      <defs>
        <linearGradient id={`${id}-metal`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f0dca6" />
          <stop offset="38%" stopColor="#c9a24b" />
          <stop offset="62%" stopColor="#9d7b2c" />
          <stop offset="100%" stopColor="#e6cd94" />
        </linearGradient>
      </defs>

      <circle cx="100" cy="100" r="96" fill="none" stroke={accent} strokeWidth="2" />
      <circle
        cx="100"
        cy="100"
        r="90"
        fill="none"
        stroke={accent}
        strokeWidth="0.75"
        strokeOpacity="0.45"
      />
      <circle
        cx="100"
        cy="100"
        r="72"
        fill="none"
        stroke={accent}
        strokeWidth="1.25"
        strokeOpacity="0.7"
      />
      <circle
        cx="100"
        cy="100"
        r="66"
        fill="none"
        stroke={accent}
        strokeWidth="3"
        strokeDasharray="1.5 6"
        strokeLinecap="round"
        strokeOpacity="0.55"
      />

      {inscribed ? (
        <>
          <path
            id={`${id}-arc-top`}
            fill="none"
            d="M100 100 m -76 0 a 76 76 0 0 1 152 0"
          />
          <text
            fill={accent}
            fontSize="10.5"
            letterSpacing="3.1"
            fontWeight="600"
            fontFamily="var(--font-sans)"
          >
            <textPath href={`#${id}-arc-top`} startOffset="50%" textAnchor="middle">
              {inscription}
            </textPath>
          </text>
          <path
            id={`${id}-arc-bottom`}
            fill="none"
            d="M100 100 m -74 0 a 74 74 0 0 0 148 0"
          />
          <text
            fill={accent}
            fontSize="9"
            letterSpacing="3.4"
            fontWeight="600"
            fontFamily="var(--font-sans)"
          >
            <textPath href={`#${id}-arc-bottom`} startOffset="50%" textAnchor="middle">
              {subInscription}
            </textPath>
          </text>
        </>
      ) : null}

      {/* shield monogram */}
      <path
        d="M100 44 142 57v35c0 24.5-18 42.5-42 52-24-9.5-42-27.5-42-52V57z"
        fill="none"
        stroke={accent}
        strokeWidth="2.25"
        strokeLinejoin="round"
      />
      <path
        d="M100 54 133 64.5v27c0 20-14.5 34.5-33 42.5-18.5-8-33-22.5-33-42.5v-27z"
        fill={accent}
        fillOpacity="0.045"
      />

      {/* classical colonnade glyph */}
      <g stroke={accent} strokeWidth="2" strokeLinecap="round">
        <path d="M74 116h52" />
        <path d="M78 116V94M88 116V94M98 116V94M108 116V94M118 116V94" />
        <path d="M72.5 92.5h55l-6-7h-43z" fill={accent} fillOpacity="0.08" />
      </g>
      <path
        d="M84 78.5 100 70l16 8.5"
        fill="none"
        stroke={`url(#${id}-metal)`}
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Wordmark({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <Seal size={compact ? 26 : 30} />
      <span className="flex flex-col leading-none">
        <span className="font-display text-[1.0625rem] font-medium tracking-[-0.02em] text-ink-deep">
          SmartGov
        </span>
        {!compact ? (
          <span className="mt-0.5 text-[0.5rem] font-semibold uppercase tracking-[0.22em] text-ink-muted">
            Student Governance
          </span>
        ) : null}
      </span>
    </span>
  );
}
