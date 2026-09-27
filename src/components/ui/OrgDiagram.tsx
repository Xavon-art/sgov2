"use client";

import { cn } from "@/lib/utils";

type Props = {
  model: "federated" | "unitary";
  className?: string;
  active?: boolean;
  accent?: string;
};

const wire = "stroke-ink-muted";

export function OrgDiagram({
  model,
  className,
  active = true,
  accent = "#16324f",
}: Props) {
  if (model === "federated") {
    return <Federated className={className} active={active} accent={accent} />;
  }
  return <Unitary className={className} active={active} accent={accent} />;
}

function Federated({
  className,
  active,
  accent,
}: {
  className?: string;
  active: boolean;
  accent: string;
}) {
  const children = [
    { cx: 42, label: "College of", sub: "Engineering" },
    { cx: 120, label: "College of", sub: "Arts & Sciences" },
    { cx: 198, label: "North", sub: "Satellite Campus" },
  ];

  return (
    <svg
      viewBox="0 0 240 132"
      className={cn("w-full", className)}
      role="img"
      aria-label="Federated structure: a University Student Government overseeing several Local Student Governments"
    >
      <g className={active ? wire : wire} strokeWidth="1" fill="none">
        <path
          d="M120 34v12"
          strokeDasharray="3 3"
          className={active ? "animate-dash" : undefined}
          opacity="0.8"
        />
        <path
          d="M42 46h156"
          strokeDasharray="3 3"
          className={active ? "animate-dash" : undefined}
          opacity="0.8"
        />
        {children.map((c, i) => (
          <path
            key={c.cx}
            d={`M${c.cx} 46v10`}
            strokeDasharray="3 3"
            className={active ? "animate-dash" : undefined}
            style={{ animationDelay: `${i * 0.18}s` }}
            opacity="0.8"
          />
        ))}
      </g>

      <g>
        <rect
          x="80"
          y="6"
          width="80"
          height="28"
          rx="7"
          fill={accent}
          fillOpacity="0.06"
          stroke={accent}
          strokeWidth="1.25"
        />
        <text
          x="120"
          y="23"
          textAnchor="middle"
          fontSize="9"
          fontWeight="600"
          letterSpacing="1.1"
          fill={accent}
          fontFamily="var(--font-sans)"
        >
          USG
        </text>
      </g>

      {children.map((c) => (
        <g key={c.cx}>
          <rect
            x={c.cx - 32}
            y="56"
            width="64"
            height="30"
            rx="7"
            fill="#ffffff"
            fillOpacity="0.86"
            stroke="currentColor"
            strokeOpacity="0.28"
            strokeWidth="1"
          />
          <text
            x={c.cx}
            y="68.5"
            textAnchor="middle"
            fontSize="7"
            fill="var(--color-muted)"
            fontFamily="var(--font-sans)"
          >
            {c.label}
          </text>
          <text
            x={c.cx}
            y="78.5"
            textAnchor="middle"
            fontSize="7.4"
            fontWeight="600"
            fill="var(--color-ink)"
            fontFamily="var(--font-sans)"
          >
            {c.sub}
          </text>
        </g>
      ))}

      <text
        x="120"
        y="104"
        textAnchor="middle"
        fontSize="7"
        letterSpacing="1.4"
        fill="var(--color-faint)"
        fontFamily="var(--font-sans)"
        fontWeight="600"
      >
        EACH REPORTS UPWARD
      </text>
      <g>
        {[0, 1, 2].map((i) => (
          <rect
            key={i}
            x={66 + i * 46}
            y="112"
            width="40"
            height="12"
            rx="3"
            fill="none"
            stroke="currentColor"
            strokeOpacity="0.16"
          />
        ))}
        <text
          x="120"
          y="121"
          textAnchor="middle"
          fontSize="6.4"
          fill="var(--color-faint)"
          fontFamily="var(--font-sans)"
        >
          budgets · projects · officers
        </text>
      </g>
    </svg>
  );
}

function Unitary({
  className,
  active,
  accent,
}: {
  className?: string;
  active: boolean;
  accent: string;
}) {
  const reps = ["Engineering", "Arts & Sci.", "North Campus"];

  return (
    <svg
      viewBox="0 0 240 132"
      className={cn("w-full", className)}
      role="img"
      aria-label="Unitary structure: a single student council containing representatives from every college"
    >
      <g strokeWidth="1" fill="none" className={wire}>
        <path
          d="M120 32v8"
          strokeDasharray="3 3"
          className={active ? "animate-dash" : undefined}
          opacity="0.8"
        />
        <path
          d="M52 40h136"
          strokeDasharray="3 3"
          className={active ? "animate-dash" : undefined}
          opacity="0.8"
        />
        <path
          d="M120 40v4"
          strokeDasharray="3 3"
          className={active ? "animate-dash" : undefined}
          opacity="0.8"
        />
      </g>

      <g>
        <rect
          x="70"
          y="4"
          width="100"
          height="28"
          rx="7"
          fill={accent}
          fillOpacity="0.06"
          stroke={accent}
          strokeWidth="1.25"
        />
        <text
          x="120"
          y="21"
          textAnchor="middle"
          fontSize="8.4"
          fontWeight="600"
          letterSpacing="0.9"
          fill={accent}
          fontFamily="var(--font-sans)"
        >
          STUDENT COUNCIL
        </text>
      </g>

      <rect
        x="16"
        y="44"
        width="208"
        height="72"
        rx="10"
        fill={accent}
        fillOpacity="0.03"
        stroke={accent}
        strokeOpacity="0.32"
        strokeWidth="1"
        strokeDasharray="4 3"
      />

      {reps.map((r, i) => {
        const x = 26 + i * 66;
        return (
          <g key={r}>
            <path
              d={`M${x + 30} 40v4`}
              strokeWidth="1"
              fill="none"
              className={wire}
              strokeDasharray="3 3"
              opacity="0.8"
            />
            <rect
              x={x}
              y="56"
              width="60"
              height="26"
              rx="6"
              fill="#ffffff"
              fillOpacity="0.9"
              stroke="currentColor"
              strokeOpacity="0.26"
            />
            <text
              x={x + 30}
              y="66.5"
              textAnchor="middle"
              fontSize="6.4"
              fill="var(--color-faint)"
              fontFamily="var(--font-sans)"
              fontWeight="600"
              letterSpacing="0.6"
            >
              REPRESENTATIVE
            </text>
            <text
              x={x + 30}
              y="76.5"
              textAnchor="middle"
              fontSize="7.4"
              fontWeight="600"
              fill="var(--color-ink)"
              fontFamily="var(--font-sans)"
            >
              {r}
            </text>
          </g>
        );
      })}

      <text
        x="120"
        y="98"
        textAnchor="middle"
        fontSize="6.8"
        fill="var(--color-muted)"
        fontFamily="var(--font-sans)"
      >
        one budget · one constitution · one council
      </text>
      <text
        x="120"
        y="126"
        textAnchor="middle"
        fontSize="7"
        letterSpacing="1.4"
        fill="var(--color-faint)"
        fontFamily="var(--font-sans)"
        fontWeight="600"
      >
        NO LOCAL TIER
      </text>
    </svg>
  );
}
