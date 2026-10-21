import { SettingsSection } from "@/components/dashboard/SettingsSection";

/**
 * LSG Settings -- the mirror of the USG one. The `side` decides the framing and
 * the Manage link, nothing else.
 */
export default function LsgSettingsPage() {
  return <SettingsSection side="lsg" />;
}
