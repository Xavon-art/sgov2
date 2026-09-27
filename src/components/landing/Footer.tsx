import Link from "next/link";
import { Seal } from "@/components/ui/Seal";

const COLUMNS: Array<{ heading: string; links: Array<{ label: string; href: string }> }> = [
  {
    heading: "Platform",
    links: [
      { label: "Dashboard", href: "/create" },
      { label: "Submissions", href: "/#features" },
      { label: "Document Verification", href: "/#features" },
      { label: "Budget Tracking", href: "/#features" },
    ],
  },
  {
    heading: "Governance",
    links: [
      { label: "Federated systems", href: "/#governance" },
      { label: "Unitary systems", href: "/#governance" },
      { label: "Comparison", href: "/#governance" },
      { label: "Create your org", href: "/create" },
    ],
  },
  {
    heading: "Institution",
    links: [
      { label: "For universities", href: "/#universities" },
      { label: "Security", href: "/#universities" },
      { label: "Accessibility", href: "/#universities" },
      { label: "Status", href: "/#universities" },
    ],
  },
];

export function Footer() {
  return (
    <footer className="border-t border-line bg-canvas">
      <div className="mx-auto max-w-[82rem] px-5 py-16 sm:px-8">
        <div className="grid gap-12 lg:grid-cols-[1.3fr_2fr]">
          <div>
            <div className="flex items-center gap-3">
              <Seal size={38} />
              <div>
                <p className="font-display text-[1.125rem] leading-none font-medium text-ink-deep">
                  SmartGov
                </p>
                <p className="mt-1.5 text-[0.5625rem] font-semibold tracking-[0.22em] text-ink-muted uppercase">
                  Student Governance Systems
                </p>
              </div>
            </div>
            <p className="mt-6 max-w-xs text-[0.875rem] leading-relaxed text-body">
              A centralized and intelligent governance management system for
              university student governments and the councils beneath them.
            </p>
          </div>

          <div className="grid gap-10 sm:grid-cols-3">
            {COLUMNS.map((col) => (
              <div key={col.heading}>
                <p className="eyebrow">{col.heading}</p>
                <ul className="mt-5 flex flex-col gap-3">
                  {col.links.map((link) => (
                    <li key={link.label}>
                      <Link
                        href={link.href}
                        className="text-[0.875rem] text-body transition-colors duration-300 hover:text-ink"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="rule mt-14" />

        <div className="mt-8 flex flex-col-reverse items-start justify-between gap-5 sm:flex-row sm:items-center">
          <p className="text-[0.75rem] text-muted">
            © {new Date().getFullYear()} SmartGov. Prototype — interface and
            account-creation flow only.
          </p>
          <p className="text-[0.75rem] text-faint">
            Built for the people who run student government.
          </p>
        </div>
      </div>
    </footer>
  );
}
