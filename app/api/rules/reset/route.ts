import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getCompanyWorkspaceId } from "@/lib/company-workspace";
import { createDefaultRuleSet } from "@/lib/defaults";
import { updateDatabase } from "@/lib/storage";

/**
 * POST /api/rules/reset
 *
 * Wipes ALL existing reminder rules, templates, and CD policies for the
 * current user's workspace and recreates them from the canonical defaults
 * (7 rules: 30 / 45 / 60 / 75 / 80 / 85 / 90 day, each firing 5 days early).
 *
 * Call from the browser console while logged in:
 *   await fetch('/api/rules/reset', { method: 'POST' }).then(r => r.json())
 */
export async function POST() {
  const user = await requireUser();
  const workspaceId = getCompanyWorkspaceId(user.companyName);

  await updateDatabase((database) => {
    // ── 1. Remove ALL existing rules, templates, CD policies for this workspace ──
    database.reminderRules = database.reminderRules.filter(
      (r) => r.ownerId !== workspaceId
    );
    database.templates = database.templates.filter(
      (t) => t.ownerId !== workspaceId
    );
    database.cashDiscountPolicies = database.cashDiscountPolicies.filter(
      (p) => p.ownerId !== workspaceId
    );

    // ── 2. Create fresh canonical defaults ──────────────────────────────────────
    const { rules, templates, cashDiscountPolicies } =
      createDefaultRuleSet(workspaceId);

    database.reminderRules.push(...rules);
    database.templates.push(...templates);
    database.cashDiscountPolicies.push(...cashDiscountPolicies);
  });

  return NextResponse.json({
    success: true,
    message:
      "All old rules and templates removed. 7 fresh rules created: " +
      "30 / 45 / 60 / 75 / 80 / 85 / 90 day (each fires 5 days early). " +
      "CD policies: 30-day=3%, 45-day=2%."
  });
}
