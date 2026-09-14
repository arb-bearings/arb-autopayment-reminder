import * as XLSX from "xlsx";
import { requireUser } from "@/lib/auth";
import { getCompanyWorkspaceContextForUser } from "@/lib/company-workspace";
import { readDatabase } from "@/lib/storage";

/**
 * GET /api/dues/test-sheet
 *
 * Generates a calibrated "test dues" Excel workbook.
 * For each enabled reminder rule the user has configured, one invoice row is
 * created whose bill date is back-calculated so that:
 *
 *   billAgeDays = triggerDay − 5   (today)
 *
 * This means when you upload the file and immediately click "Generate eligible
 * reminders" with today's date, every rule will fire exactly once.
 *
 * The sheet is returned as a downloadable .xlsx attachment.
 */
export async function GET() {
  const user = await requireUser();
  const database = await readDatabase();
  const workspace = getCompanyWorkspaceContextForUser(database, user);

  const enabledRules = database.reminderRules
    .filter((r) => r.ownerId === workspace.configOwnerId && r.enabled)
    .sort((a, b) => a.triggerDay - b.triggerDay);

  if (enabledRules.length === 0) {
    return new Response(
      JSON.stringify({ error: "No enabled reminder rules found." }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const today = new Date();

  /** Returns YYYY-MM-DD string offset by daysAgo from today */
  function offsetDate(daysAgo: number): string {
    const d = new Date(today);
    d.setDate(d.getDate() - daysAgo);
    return d.toISOString().split("T")[0];
  }

  /**
   * Dealer prefixes so each rule maps to a distinct test party.
   * More can be added — they cycle if there are more rules than names.
   */
  const partyNames = [
    "Orion Wholesale Pvt Ltd",
    "Nimbus Surgical Agencies",
    "Cedar Retail Mart",
    "Apex Medico Distributors",
    "Zenith Pharma Labs",
    "Matrix Health Link",
    "Nova Care Enterprises",
    "Pinnacle Traders",
    "Summit Medical Stores",
    "Horizon Distributors",
  ];

  const refPrefixes = ["OR", "NB", "CD", "AP", "ZN", "MX", "NV", "PN", "SM", "HZ"];

  const rows = enabledRules.map((rule, index) => {
    let fireBillAge = rule.triggerDay - 5;
    if (rule.triggerDay === 120) {
      fireBillAge = 125; // Age > 120 for 120+ bucket
    } else if (rule.triggerDay === 90) {
      fireBillAge = 95;  // Age 90-120 for 90+ bucket
    } else if (rule.triggerDay === 75) {
      fireBillAge = 75;  // Age 60-90 for 60+ bucket
    } else if (rule.triggerDay === 60) {
      fireBillAge = 55;  // Age 50-60 for 60d bucket
    } else if (rule.triggerDay === 45) {
      fireBillAge = 42;  // Age 40-45 for 2% CD bucket
    } else if (rule.triggerDay === 30) {
      fireBillAge = 28;  // Age 25-30 for 3% CD bucket
    }

    const billDate = offsetDate(fireBillAge);        // back-calc from today
    const dueDate  = offsetDate(fireBillAge > 30 ? fireBillAge - 30 : 0);

    const party  = partyNames[index % partyNames.length];
    const prefix = refPrefixes[index % refPrefixes.length];
    const seqNum = String(1000 + index + 1);

    return {
      "Ref. No.":     `${prefix}-${seqNum}`,
      "opening":      Math.round(10000 + (index + 1) * 7500),
      "pending":      Math.round(8000  + (index + 1) * 6000),
      "overdue":      0,
      "Date":         billDate,          // ← bill age = fireBillAge on today
      "Party's Name": party,
      "Due on":       dueDate,
      "Dealer Code":  `TST${String(index + 1).padStart(3, "0")}`,
      "Currency":     "INR",
    };
  });

  // Build the workbook
  const worksheet = XLSX.utils.json_to_sheet(rows);
  worksheet["!cols"] = Object.keys(rows[0] || {}).map((header) => ({
    wch: Math.max(header.length + 2, 16),
  }));

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Due Database");

  const dateTag = today.toISOString().split("T")[0]; // e.g. 2026-08-05
  const fileName = `test-dues-${dateTag}.xlsx`;

  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

  return new Response(buffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}
