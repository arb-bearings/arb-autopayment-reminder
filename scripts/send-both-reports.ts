/**
 * send-both-reports.ts
 * Sends the Owner (Daily Activity) Report AND the Manager (Salesperson Summary) Report
 * to amankumarschool7@gmail.com right now.
 *
 * Usage:
 *   npx ts-node --project tsconfig.json scripts/send-both-reports.ts
 */

import fs from "fs";
import path from "path";

// ── Load .env.local ──────────────────────────────────────────────────────────
try {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, "utf8");
    for (const line of envContent.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim();
        process.env[key] = val;
      }
    }
    console.log("Loaded .env.local");
  }
} catch (e) {
  console.warn("Could not load .env.local", e);
}

import { readDatabase } from "../lib/storage";
import { getCompanyWorkspaceContextForUser } from "../lib/company-workspace";
import { resolveDispatchSettings } from "../lib/dispatch-settings";
import { generateSalespersonSummaryPDF } from "../lib/pdf-generator";
import {
  buildSalespersonSummaryHtml,
  buildSalespersonSummaryText,
  buildDailyActivityReport,
} from "../lib/reports";
import nodemailer from "nodemailer";

const TARGET_EMAIL = "amankumarschool7@gmail.com";

async function run() {
  console.log("\n══════════════════════════════════════════════════════");
  console.log("  Sending Manager Report + Owner Report");
  console.log(`  Recipient: ${TARGET_EMAIL}`);
  console.log("══════════════════════════════════════════════════════\n");

  // ── Load database ──────────────────────────────────────────────────────────
  console.log("Loading database...");
  let database: Awaited<ReturnType<typeof readDatabase>>;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      database = await readDatabase();
      console.log(`Database loaded (attempt ${attempt})`);
      break;
    } catch (err) {
      console.warn(`Attempt ${attempt} to connect to DB failed, retrying in 2s...`, err);
      if (attempt === 4) throw err;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  // ── Resolve user & settings ────────────────────────────────────────────────
  const user =
    database!.users.find(
      (u) => u.email === "arbbearings.marketing@gmail.com" || u.role === "super_admin"
    ) || database!.users[0];

  if (!user) throw new Error("No user found in database!");

  const workspace = getCompanyWorkspaceContextForUser(database!, user);
  const settings = resolveDispatchSettings(
    database!.dispatchSettings.find((s) => s.ownerId === workspace.configOwnerId) ?? {
      ownerId: workspace.configOwnerId,
    }
  );

  console.log("Using SMTP settings:", {
    host: settings.smtpHost,
    port: settings.smtpPort,
    user: settings.smtpUser,
    from: settings.senderEmail || settings.smtpFrom,
  });

  const transporter = nodemailer.createTransport({
    host: settings.smtpHost,
    port: settings.smtpPort,
    secure: settings.smtpSecure,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 15000,
    auth: settings.smtpUser
      ? { user: settings.smtpUser, pass: settings.smtpPass }
      : undefined,
  });

  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);

  // ══════════════════════════════════════════════════════════════════════════
  // 1. MANAGER REPORT (Salesperson / Manager Summary with PDF)
  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n─── [1/2] Generating Manager Report ────────────────────");

  const configuredSalespersons = (database!.salespersons || []).filter(
    (sp) =>
      workspace.sharedOwnerIds.has(sp.ownerId) || sp.ownerId === workspace.configOwnerId
  );

  const allDues = (database!.dueRecords || []).filter((d) => (d.amount || 0) > 0);

  const salespersonMap = new Map<
    string,
    { name: string; email: string; records: typeof allDues }
  >();

  for (const sp of configuredSalespersons) {
    const emailKey = sp.email.trim().toLowerCase();
    if (!emailKey) continue;
    const normalizedCodes = (sp.dealerCodes || []).map((c) => c.trim().toLowerCase());

    const assignedDues = allDues.filter((due) => {
      const code = (due.dealerCode || due.customerCode || "").trim().toLowerCase();
      return (
        normalizedCodes.includes(code) ||
        (due.salespersonEmail || "").trim().toLowerCase() === emailKey ||
        (due.salespersonName || "").trim().toLowerCase() === sp.name.trim().toLowerCase()
      );
    });

    const existing = salespersonMap.get(emailKey);
    if (existing) {
      const idSet = new Set(existing.records.map((r) => r.id));
      for (const r of assignedDues) if (!idSet.has(r.id)) existing.records.push(r);
    } else {
      salespersonMap.set(emailKey, {
        name: sp.name,
        email: sp.email.trim(),
        records: assignedDues,
      });
    }
  }

  for (const due of allDues) {
    if (!due.salespersonEmail) continue;
    const emailKey = due.salespersonEmail.trim().toLowerCase();
    if (!salespersonMap.has(emailKey)) {
      salespersonMap.set(emailKey, {
        name: due.salespersonName || emailKey,
        email: due.salespersonEmail.trim(),
        records: [],
      });
    }
    const existing = salespersonMap.get(emailKey)!;
    const idSet = new Set(existing.records.map((r) => r.id));
    if (!idSet.has(due.id)) existing.records.push(due);
  }

  let managerSent = 0;

  for (const [, spData] of salespersonMap.entries()) {
    const { name, records } = spData;
    if (records.length === 0) continue;

    try {
      console.log(`  Generating PDF for manager: ${name} (${records.length} dues)`);
      const pdfBuffer = await generateSalespersonSummaryPDF(
        name,
        records,
        [],
        database!.reminderRules
      );
      const html = buildSalespersonSummaryHtml(name, records, [], database!.reminderRules);
      const text = buildSalespersonSummaryText(name, records, [], database!.reminderRules);
      const filename = `Manager-Outstanding-Report-${name.toLowerCase().replace(/[^a-z0-9]/g, "-")}.pdf`;

      await transporter.sendMail({
        from: settings.senderEmail || settings.smtpFrom,
        to: [TARGET_EMAIL],
        subject: `Manager Outstanding & Aging Report - ${name} (${todayStr})`,
        text,
        html,
        attachments: [{ filename, content: pdfBuffer }],
      });

      console.log(`  Manager report for ${name} -> ${TARGET_EMAIL} [OK]`);
      managerSent++;
    } catch (err) {
      console.error(`  Failed for ${name}:`, err);
    }
  }

  // Fallback: send combined report if no salesperson mapping
  if (managerSent === 0) {
    console.log("  No salesperson mapping found; sending combined report for all dues...");
    try {
      const pdfBuffer = await generateSalespersonSummaryPDF(
        "All Managers",
        allDues,
        [],
        database!.reminderRules
      );
      const html = buildSalespersonSummaryHtml("All Managers", allDues, [], database!.reminderRules);
      const text = buildSalespersonSummaryText("All Managers", allDues, [], database!.reminderRules);

      await transporter.sendMail({
        from: settings.senderEmail || settings.smtpFrom,
        to: [TARGET_EMAIL],
        subject: `Manager Outstanding & Aging Report - All Managers (${todayStr})`,
        text,
        html,
        attachments: [{ filename: "Manager-Outstanding-Report-all.pdf", content: pdfBuffer }],
      });
      console.log(`  Combined manager report -> ${TARGET_EMAIL} [OK]`);
      managerSent = 1;
    } catch (err) {
      console.error("  Failed to send combined manager report:", err);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 2. OWNER REPORT (Daily Activity Report)
  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n─── [2/2] Generating Owner (Daily Activity) Report ─────");

  try {
    const report = await buildDailyActivityReport(user, today);

    await transporter.sendMail({
      from: settings.senderEmail || settings.smtpFrom,
      to: [TARGET_EMAIL],
      subject: `Owner Daily Activity Report - ${todayStr}`,
      text: report.text,
      html: report.html,
    });

    console.log(`  Owner report -> ${TARGET_EMAIL} [OK]`);
  } catch (err) {
    console.error("  Failed to send owner report:", err);
  }

  console.log("\n══════════════════════════════════════════════════════");
  console.log("  Done! Check your inbox at: " + TARGET_EMAIL);
  console.log("══════════════════════════════════════════════════════\n");
}

run().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
