import { SettingsSection } from "@/components/dashboard/SettingsSection";

/**
 * USG Settings. The account's own controls -- everything about the work lives in
 * its own section, so this is only about the person holding the seat.
 */
export default function UsgSettingsPage() {
  return <SettingsSection side="usg" />;
}
