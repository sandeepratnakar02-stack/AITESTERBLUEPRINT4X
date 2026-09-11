import type { Metadata } from "next";
import { PageHeader } from "@/components/dashboard/page-header";
import { SettingsForm } from "@/components/dashboard/settings-form";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <div className="space-y-5">
      <PageHeader
        title="Settings"
        description="Monitoring thresholds, retry policy and environment configuration for the VWO QA health checks."
      />
      <SettingsForm />
    </div>
  );
}
