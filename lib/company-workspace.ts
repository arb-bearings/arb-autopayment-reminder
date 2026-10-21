import type { AppDatabase, User } from "@/lib/types";
import { slugify } from "@/lib/utils";

// ─── Supported Company Workspaces ─────────────────────────────────────────────

export const SUPPORTED_COMPANIES = [
  {
    code: "ARB",
    slug: "arb-bearings",
    label: "ARB Bearings",
    fullName: "ARB Bearings Private Limited",
    dbEnvVar: "MONGODB_DB",
    defaultDbName: "auto-payment-reminder"
  },
  {
    code: "LUB",
    slug: "arb-lubricants",
    label: "ARB Lubricants",
    fullName: "ARB Lubricants Private Limited",
    dbEnvVar: "MONGODB_DB_LUBRICANTS",
    defaultDbName: "auto-payment-reminder-lubricants"
  }
] as const;

export type CompanyCode = (typeof SUPPORTED_COMPANIES)[number]["code"];

/** Cookie name used to track which workspace the user is currently in */
export const ACTIVE_COMPANY_COOKIE = "apr_active_company";

/**
 * Given a companyCode ("ARB" or "LUB"), return the canonical full company name
 * used in message templates. Falls back to ARB if unknown.
 */
export function resolveCompanyFullName(companyCode: string): string {
  const code = normalizeCompanyCode(companyCode);
  const match = SUPPORTED_COMPANIES.find((c) => c.code === code);
  return match?.fullName ?? SUPPORTED_COMPANIES[0].fullName;
}

/**
 * Given a company code or slug stored in the cookie, return the normalized CompanyCode.
 */
export function normalizeCompanyCode(value: string): CompanyCode {
  const normalized = (value || "").trim().toLowerCase();
  if (
    normalized === "lub" ||
    normalized === "arb-lubricants" ||
    normalized === "lubricants" ||
    normalized === "ans" ||
    normalized === "ans-lubricants"
  ) {
    return "LUB";
  }
  return "ARB";
}

// ─── Workspace Context ─────────────────────────────────────────────────────────

export function getCompanyWorkspaceId(companyName: string) {
  const slug = slugify(companyName || "");
  return `company:${slug || "workspace"}`;
}

export function getCompanyUsers(database: AppDatabase, companyName: string) {
  const targetCode = normalizeCompanyCode(companyName);
  return database.users.filter(
    (entry) => normalizeCompanyCode(entry.companyName) === targetCode
  );
}

export function getCompanyWorkspaceContext(database: AppDatabase, companyName: string) {
  const workspaceId = getCompanyWorkspaceId(companyName);
  const companyUsers = getCompanyUsers(database, companyName).sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt)
  );
  const adminUser =
    companyUsers.find((entry) => entry.role === "super_admin") ||
    companyUsers.find((entry) => entry.role === "admin") ||
    companyUsers[0] ||
    null;

  const code = normalizeCompanyCode(companyName);
  const commonAliases =
    code === "LUB"
      ? ["company:arb-lubricants", "company:arb-lubricants-private-limited", "company:ans-lubricants"]
      : [
          "company:arb-bearings",
          "company:arb-bearings-private-limited",
          "company:arb-bearing-pvt-limited",
          "company:ans-bearings"
        ];

  const sharedOwnerIds = new Set<string>([
    workspaceId,
    ...commonAliases,
    ...companyUsers.map((entry) => entry.id)
  ]);
  const configOwnerId = adminUser?.id || workspaceId;

  return {
    workspaceId,
    companyUsers,
    adminUser,
    configOwnerId,
    sharedOwnerIds
  };
}

export function isSharedCompanyRecord(ownerId: string, sharedOwnerIds: Set<string>) {
  return sharedOwnerIds.has(ownerId);
}

export function filterSharedCompanyRecords<T extends { ownerId: string }>(
  entries: T[],
  sharedOwnerIds: Set<string>
) {
  return entries.filter((entry) => isSharedCompanyRecord(entry.ownerId, sharedOwnerIds));
}

export function getCompanyWorkspaceContextForUser(database: AppDatabase, user: Pick<User, "companyName">) {
  return getCompanyWorkspaceContext(database, user.companyName);
}
