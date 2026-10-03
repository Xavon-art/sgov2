import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.25,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function IconDashboard(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M3.5 9.5 12 4l8.5 5.5" />
      <path d="M5.5 10.5V19h13v-8.5" />
      <path d="M12 13.5v3M10.5 15h3" />
    </svg>
  );
}

export function IconSubmission(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M6 3.5h7.5L18 8v12.5H6z" />
      <path d="M13.5 3.5V8H18" />
      <path d="M8.75 12.5h6.5M8.75 15.75h4.5" />
    </svg>
  );
}

export function IconVerification(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M12 3.2 19 6v6.2c0 4-3 7-7 8.6-4-1.6-7-4.6-7-8.6V6z" />
      <path d="M9 12.2 11.2 14.4 15.4 10" />
    </svg>
  );
}

export function IconTracking(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <circle cx="6" cy="17.5" r="2.2" />
      <circle cx="18" cy="6.5" r="2.2" />
      <path d="M8.1 16.4 15.9 7.6" strokeDasharray="2.4 2.6" />
      <path d="M12 4.5h4.5" />
    </svg>
  );
}

export function IconArchive(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M3.75 6.5h16.5V19a1 1 0 0 1-1 1H4.75a1 1 0 0 1-1-1z" />
      <path d="M2.75 4h18.5v2.5H2.75z" />
      <path d="M9.75 10.5h4.5" />
    </svg>
  );
}

export function IconMonitoring(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M4 19.5V11M9.33 19.5V5.5M14.67 19.5v-6M20 19.5V8.5" />
      <path d="M3 19.5h18" />
    </svg>
  );
}

export function IconBudget(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <ellipse cx="12" cy="6.75" rx="7" ry="2.75" />
      <path d="M5 6.75v10.5c0 1.52 3.13 2.75 7 2.75s7-1.23 7-2.75V6.75" />
      <path d="M5 12c0 1.52 3.13 2.75 7 2.75s7-1.23 7-2.75" />
    </svg>
  );
}

export function IconEvents(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <rect x="3.75" y="5.5" width="16.5" height="14.25" rx="1.5" />
      <path d="M3.75 10h16.5M8.25 3.5v4M15.75 3.5v4" />
      <circle cx="8.75" cy="14" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconArrowRight(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M4.5 12h15" />
      <path d="M13.75 6.25 19.5 12l-5.75 5.75" />
    </svg>
  );
}

export function IconArrowLeft(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M19.5 12h-15" />
      <path d="M10.25 6.25 4.5 12l5.75 5.75" />
    </svg>
  );
}

export function IconCheck(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M5 12.75 9.75 17.5 19 6.75" />
    </svg>
  );
}

export function IconCheckCircle(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.25 12.25 11 15l4.75-5.5" />
    </svg>
  );
}

export function IconShield(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M12 3 19 5.75v6.5c0 4.15-3 7.25-7 8.75-4-1.5-7-4.6-7-8.75V5.75z" />
      <path d="M12 8.25v7.5M9 10.25 12 8l3 2.25" />
    </svg>
  );
}

export function IconMail(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <rect x="3" y="5.5" width="18" height="13" rx="1.75" />
      <path d="m3.75 7 8.25 5.75L20.25 7" />
    </svg>
  );
}

export function IconLock(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <rect x="4.75" y="10.5" width="14.5" height="9.75" rx="1.75" />
      <path d="M8.25 10.5V7.75a3.75 3.75 0 0 1 7.5 0v2.75" />
      <path d="M12 14.25v2.5" />
    </svg>
  );
}

export function IconUser(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <circle cx="12" cy="8" r="3.75" />
      <path d="M4.75 20.25c0-3.6 3.25-5.75 7.25-5.75s7.25 2.15 7.25 5.75" />
    </svg>
  );
}

export function IconBuilding(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M4 20.25V6.5l7-3.25 7 3.25v13.75" />
      <path d="M2.75 20.25h18.5" />
      <path d="M8.25 9.5h2.5M13.25 9.5h2.5M8.25 13.25h2.5M13.25 13.25h2.5" />
    </svg>
  );
}

export function IconSparkle(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M12 3.5 13.7 9.1 19.5 10.8 13.7 12.5 12 18.1 10.3 12.5 4.5 10.8 10.3 9.1z" />
    </svg>
  );
}

export function IconPencil(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M4.5 19.5h4l10-10a2.12 2.12 0 0 0-3-3l-10 10z" />
      <path d="M14.5 6.5 17.5 9.5" />
    </svg>
  );
}

export function IconMenu(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M4 7.5h16M4 12h16M4 16.5h16" />
    </svg>
  );
}

export function IconClose(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

export function IconLayers(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M12 3.5 21 8l-9 4.5L3 8z" />
      <path d="m3 12.5 9 4.5 9-4.5" />
      <path d="m3 16.75 9 4.5 9-4.5" />
    </svg>
  );
}

export function IconPyramid(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M12 3.5 21.5 20H2.5z" />
      <path d="M12 9.5 16.5 20M12 9.5 7.5 20" />
    </svg>
  );
}

export function IconClock(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 1.75" />
    </svg>
  );
}

export function IconUpload(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M12 15.5V4.5" />
      <path d="m8 8.25 4-3.75 4 3.75" />
      <path d="M4.25 15v3.75a1.5 1.5 0 0 0 1.5 1.5h12.5a1.5 1.5 0 0 0 1.5-1.5V15" />
    </svg>
  );
}

export function IconCompass(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m15.25 8.75-1.75 4.75-4.75 1.75 1.75-4.75z" />
    </svg>
  );
}

export function IconEye(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M2.5 12S6 5.75 12 5.75 21.5 12 21.5 12 18 18.25 12 18.25 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

/** The same eye with a strike through it, so the two states read as one pair. */
export function IconEyeOff(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M4 4l16 16" />
      <path d="M9.9 5.9A9.9 9.9 0 0 1 12 5.75c6 0 9.5 6.25 9.5 6.25a17.6 17.6 0 0 1-2.4 3.2" />
      <path d="M6.6 7.85A17.8 17.8 0 0 0 2.5 12S6 18.25 12 18.25a9.8 9.8 0 0 0 3.35-.6" />
      <path d="M10.3 10.3a2.5 2.5 0 0 0 3.4 3.4" />
    </svg>
  );
}
