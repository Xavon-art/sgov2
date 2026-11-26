import { STATUS_CLASS, STATUS_LABEL, type Status } from "@/lib/status";

export function StatusBadge({
  status,
  late = false,
  className = "",
}: {
  status: Status;
  late?: boolean;
  className?: string;
}) {
  return (
    <span className={`inline-flex flex-wrap items-center gap-1.5 ${className}`}>
      <span className={`rounded-full border px-2 py-0.5 text-xs ${STATUS_CLASS[status]}`}>
        {STATUS_LABEL[status]}
      </span>
      {late ? (
        <span className="rounded-full border border-[#a5442c]/35 bg-[#a5442c]/[0.08] px-2 py-0.5 text-xs font-semibold text-[#a5442c]">
          Late
        </span>
      ) : null}
    </span>
  );
}
