import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { canDispatchReminders, requireOperationPassword } from "@/lib/access-control";
import { recordAuditLog } from "@/lib/audit";
import { generateRemindersForUser } from "@/lib/reminder-engine";

export async function POST(request: Request) {
  const user = await requireUser();
  const formData = await request.formData();
  const generationDate = String(formData.get("generationDate") || "").trim();
  const operationPassword = String(formData.get("operationPassword") || "");
  const forceAllRules = formData.get("forceAllRules") === "true";

  try {
    if (!canDispatchReminders(user)) {
      throw new Error("Reminder generation access denied.");
    }
    await requireOperationPassword(user, "dispatch", operationPassword);
    const generated = await generateRemindersForUser(user.id, generationDate || undefined, forceAllRules);
    const matchedCount = generated.filter((entry) => entry.status === "pending" || entry.status === "sent").length;
    const missingCount = generated.filter((entry) => entry.status === "failed").length;

    await recordAuditLog(
      user,
      "Reminder Dispatch",
      "success",
      `Generated ${generated.length} reminders (${matchedCount} matched, ${missingCount} missing contacts).`
    );

    const message = missingCount > 0
      ? `Generated ${generated.length} reminders (${matchedCount} contacts matched, ${missingCount} missing contacts). Click "View Breakdown Table" under the generate button to inspect details.`
      : `Generated ${generated.length} eligible reminders with all contacts matched. Review the queue, then send reminders when ready.`;

    return NextResponse.redirect(
      new URL(
        `/dashboard/dues?message=${encodeURIComponent(message)}`,
        request.url
      ),
      { status: 303 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Reminder generation failed.";
    try {
      await recordAuditLog(user, "Reminder Dispatch", "failed", message);
    } catch (auditError) {
      console.error("Failed to record audit log:", auditError);
    }
    return NextResponse.redirect(
      new URL(`/dashboard/dues?error=${encodeURIComponent(message)}`, request.url),
      { status: 303 }
    );
  }
}
