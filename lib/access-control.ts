import { redirect } from "next/navigation";
import { getCompanyWorkspaceContextForUser } from "@/lib/company-workspace";
import { hashPassword, requireUser, verifyPassword } from "@/lib/auth";
import { readDatabase, updateDatabase } from "@/lib/storage";
import type { OperationPasswordKey, User } from "@/lib/types";

export const operationPasswordLabels: Record<OperationPasswordKey, string> = {
  master_upload: "Master Database Upload",
  due_upload: "Due Database Upload",
  dispatch: "Dispatch Operations",
  report_generation: "Report Generation",
  admin_settings: "Admin Settings"
};

export function isSuperAdminUser(user: Pick<User, "role"> | null | undefined) {
  return user?.role === "super_admin";
}

export function isAdminLikeUser(user: Pick<User, "role"> | null | undefined) {
  return user?.role === "super_admin" || user?.role === "admin";
}

export function canUploadMasterDatabase(user: Pick<User, "role">) {
  return isAdminLikeUser(user);
}

export function canUploadDueDatabase(user: Pick<User, "role">) {
  return isAdminLikeUser(user) || user.role === "user";
}

export function canDispatchReminders(user: Pick<User, "role" | "canSendManualReminders">) {
  return isAdminLikeUser(user) || user.role === "user" || user.canSendManualReminders;
}

export function canAccessReports(user: Pick<User, "role">) {
  return isAdminLikeUser(user);
}

export function canManageAdminSettings(user: Pick<User, "role">) {
  return isSuperAdminUser(user);
}

export async function requireSuperAdminUser() {
  const user = await requireUser();

  if (!isSuperAdminUser(user)) {
    redirect("/dashboard?error=Super%20Admin%20access%20required");
  }

  return user;
}

export async function verifyOperationPasswordForUser(
  user: Pick<User, "companyName">,
  key: OperationPasswordKey,
  password: string
) {
  const database = await readDatabase();
  const workspace = getCompanyWorkspaceContextForUser(database, user);
  const configured = database.operationPasswords.find(
    (entry) => entry.ownerId === workspace.configOwnerId && entry.key === key
  );

  if (!configured?.passwordHash) {
    return true;
  }

  return Boolean(password) && verifyPassword(password, configured.passwordHash);
}

export async function requireOperationPassword(
  user: Pick<User, "companyName">,
  key: OperationPasswordKey,
  password: string
) {
  const ok = await verifyOperationPasswordForUser(user, key, password);

  if (!ok) {
    throw new Error(`${operationPasswordLabels[key]} password is incorrect.`);
  }
}

export async function saveOperationPasswords(
  user: Pick<User, "id" | "companyName">,
  values: Partial<Record<OperationPasswordKey, string>>
) {
  await updateDatabase((database) => {
    const workspace = getCompanyWorkspaceContextForUser(database, user);
    const now = new Date().toISOString();

    Object.entries(values).forEach(([rawKey, password]) => {
      const key = rawKey as OperationPasswordKey;
      const trimmed = String(password || "").trim();

      if (!trimmed) {
        return;
      }

      if (trimmed.length < 8) {
        throw new Error(`${operationPasswordLabels[key]} password must be at least 8 characters long.`);
      }

      const existing = database.operationPasswords.find(
        (entry) => entry.ownerId === workspace.configOwnerId && entry.key === key
      );

      if (existing) {
        existing.passwordHash = hashPassword(trimmed);
        existing.label = operationPasswordLabels[key];
        existing.updatedAt = now;
        existing.updatedBy = user.id;
        return;
      }

      database.operationPasswords.push({
        ownerId: workspace.configOwnerId,
        key,
        label: operationPasswordLabels[key],
        passwordHash: hashPassword(trimmed),
        updatedAt: now,
        updatedBy: user.id
      });
    });
  });
}
