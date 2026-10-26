import fs from "fs";
import path from "path";

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
  }
} catch (e) {
  console.warn("Could not load .env.local", e);
}

import { readDatabase } from "../lib/storage";
import { getCompanyWorkspaceContextForUser } from "../lib/company-workspace";
import { resolveDispatchSettings } from "../lib/dispatch-settings";
import { buildDailyActivityReport } from "../lib/reports";
import nodemailer from "nodemailer";

const TARGET_EMAIL = "amankumarschool7@gmail.com";

async function run() {
  console.log("Loading database...");
  const database = await readDatabase();
  const user =
    database.users.find(
      (u) => u.email === "arbbearings.marketing@gmail.com" || u.role === "super_admin"
    ) || database.users[0];

  if (!user) throw new Error("No user found in database!");

  const workspace = getCompanyWorkspaceContextForUser(database, user);
  const settings = resolveDispatchSettings(
    database.dispatchSettings.find((s) => s.ownerId === workspace.configOwnerId) ?? {
      ownerId: workspace.configOwnerId,
    }
  );

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

  console.log("Generating Owner (Daily Activity) Report...");
  const report = await buildDailyActivityReport(user, today);

  console.log("\n--- Previewing generated report text ---");
  console.log(report.text.slice(0, 1500));

  console.log("\nSending Owner Report email to:", TARGET_EMAIL);
  await transporter.sendMail({
    from: settings.senderEmail || settings.smtpFrom,
    to: [TARGET_EMAIL],
    subject: `Owner Daily Activity Report - ${todayStr}`,
    text: report.text,
    html: report.html,
  });

  console.log("✅ Owner report successfully sent to:", TARGET_EMAIL);
}

run().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
