"use client";

import { AccountSection } from "@/components/dashboard/AccountSection";
import { ProfileCustomization } from "@/components/dashboard/ProfileCustomization";

export default function DashboardAccountPage() {
  return (
    <>
      <AccountSection />
      <ProfileCustomization />
    </>
  );
}