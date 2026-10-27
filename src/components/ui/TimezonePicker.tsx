"use client";

import { useEffect, useState } from "react";

const COMMON_TIMEZONES = [
  "Asia/Manila",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Asia/Hong_Kong",
  "Asia/Shanghai",
  "Asia/Kolkata",
  "Europe/London",
  "Europe/Paris",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "UTC",
];

export function TimezonePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (tz: string) => void;
}) {
  const [tz, setTz] = useState(value || "Asia/Manila");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (value) setTz(value);
  }, [value]);

  return (
    <select
      value={tz}
      onChange={(e) => {
        setTz(e.target.value);
        onChange(e.target.value);
      }}
      className="h-11 w-full rounded-xl border border-line bg-paper/70 px-3.5 text-[0.9375rem] text-ink-deep outline-none focus:border-ink/25"
    >
      {COMMON_TIMEZONES.map((t) => (
        <option key={t} value={t}>
          {t}
        </option>
      ))}
    </select>
  );
}