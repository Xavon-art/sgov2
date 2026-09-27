import type { Metadata } from "next";
import { StepShell } from "@/components/create/StepShell";
import { StartButton } from "@/components/create/WelcomeStart";
import {
  IconArchive,
  IconCompass,
  IconShield,
  IconTracking,
} from "@/components/ui/Icons";

export const metadata: Metadata = {
  title: "Set up your student organization",
  description:
    "Start creating your SmartGov student organization in a few short steps.",
};

const PREVIEW = [
  {
    icon: IconCompass,
    title: "Choose your governance model",
    body: "Federated with local councils, or a single unitary council. This shapes everything after it.",
  },
  {
    icon: IconShield,
    title: "Create your administrator account",
    body: "Your name, email, and role. You can invite every other officer afterwards.",
  },
  {
    icon: IconArchive,
    title: "Tell us about your institution",
    body: "University, campus, college, and the seal you want shown on your charter.",
  },
  {
    icon: IconTracking,
    title: "Review and confirm",
    body: "One last look at everything, then your organization is chartered.",
  },
];

export default function CreateWelcomePage() {
  return (
    <StepShell
      step="welcome"
      tone="bare"
      title={
        <>
          Let&rsquo;s set up your
          <br className="hidden sm:block" /> student government system.
        </>
      }
      lede="Four short steps. You can go back and change anything before you confirm — nothing is submitted until the very end."
    >
      <ol className="flex flex-col">
        {PREVIEW.map((item, i) => {
          const Icon = item.icon;
          return (
            <li
              key={item.title}
              className="group flex gap-5 border-t border-line py-6 first:border-t-0 first:pt-0"
            >
              <span className="mt-0.5 flex shrink-0 flex-col items-center gap-2">
                <span className="grid size-9 place-items-center rounded-full border border-line-strong bg-canvas text-ink-muted transition-colors duration-500 group-hover:border-brass/50 group-hover:text-ink-deep">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="font-mono text-[0.5625rem] tracking-[0.18em] text-faint">
                  0{i + 1}
                </span>
              </span>
              <div className="min-w-0">
                <h2 className="text-[1rem] leading-snug font-medium text-ink-deep sm:text-[1.0625rem]">
                  {item.title}
                </h2>
                <p className="mt-1.5 text-[0.875rem] leading-relaxed text-body">
                  {item.body}
                </p>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="mt-9 border-t border-line pt-7">
        <StartButton />
        <p className="mt-4 text-center text-[0.75rem] text-muted">
          Your progress is kept for this browser session only.
        </p>
      </div>
    </StepShell>
  );
}
