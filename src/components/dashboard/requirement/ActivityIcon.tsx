import {
  IconEvents,
  IconCompass,
  IconVerification,
  IconBuilding,
  IconShield,
  IconSparkle,
} from "@/components/ui/Icons";
import type { ActivityType } from "./types";

const ICONS: Record<ActivityType, typeof IconEvents> = {
  sports: IconEvents,
  culture: IconCompass,
  academic: IconVerification,
  community: IconBuilding,
  wellness: IconShield,
  special: IconSparkle,
};

export function ActivityIcon({ type, className }: { type: ActivityType; className?: string }) {
  const Icon = ICONS[type] ?? IconSparkle;
  return <Icon className={className ?? "h-4 w-4"} />;
}