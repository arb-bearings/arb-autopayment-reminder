import type { ReactNode } from "react";
import { DashboardClientShell } from "@/components/dashboard-client-shell";

export function DashboardShell({
  children,
  title,
  description,
  companyName,
  companyCode,
  userName,
  isAdmin,
  userRole = "user",
  canSendManualReminders = false
}: {
  children: ReactNode;
  title: string;
  description: string;
  companyName: string;
  companyCode?: string;
  userName: string;
  isAdmin: boolean;
  userRole?: "super_admin" | "admin" | "user";
  canSendManualReminders?: boolean;
}) {
  return (
    <DashboardClientShell
      title={title}
      description={description}
      companyName={companyName}
      companyCode={companyCode ?? "ARB"}
      userName={userName}
      isAdmin={isAdmin}
      userRole={userRole}
      canSendManualReminders={canSendManualReminders}
    >
      {children}
    </DashboardClientShell>
  );
}
