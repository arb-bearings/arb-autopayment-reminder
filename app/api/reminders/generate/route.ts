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
    await recordAuditLog(
      user,
      "Reminder Dispatch",
      "success",
      `Generated ${generated.length} reminders.`
    );

    return NextResponse.redirect(
      new URL(
        `/dashboard/dues?message=${encodeURIComponent(
          `Generated ${generated.length} eligible reminders. Review the queue, then send reminders when ready. Reports will be sent after reminders are sent.`
        )}`,
        request.url
      ),
      { status: 303 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Reminder generation failed.";
    await recordAuditLog(user, "Reminder Dispatch", "failed", message);
    return NextResponse.redirect(
      new URL(`/dashboard/dues?error=${encodeURIComponent(message)}`, request.url),
      { status: 303 }
    );
  }
}
