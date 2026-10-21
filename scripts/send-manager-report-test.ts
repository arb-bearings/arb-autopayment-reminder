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
import { generateSalespersonSummaryPDF } from "../lib/pdf-generator";
import { buildSalespersonSummaryHtml, buildSalespersonSummaryText } from "../lib/reports";
import nodemailer from "nodemailer";

async function run() {
  console.log("Loading database...");
  let database;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      database = await readDatabase();
      break;
    } catch (err) {
      console.warn(`Attempt ${attempt} to connect to DB failed, retrying in 2s...`, err);
      if (attempt === 4) throw err;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  const user = database.users.find(
    (u) => u.email === "arbbearings.marketing@gmail.com" || u.role === "super_admin"
  ) || database.users[0];

  if (!user) {
    throw new Error("No user found in database!");
  }

  const workspace = getCompanyWorkspaceContextForUser(database, user);
  const settings = resolveDispatchSettings(
    database.dispatchSettings.find((s) => s.ownerId === workspace.configOwnerId) ?? {
      ownerId: workspace.configOwnerId
    }
  );

  console.log("Using SMTP settings:", {
    host: settings.smtpHost,
    port: settings.smtpPort,
    user: settings.smtpUser,
    from: settings.senderEmail || settings.smtpFrom
  });

  // Find manager Aman or configure Aman's dealers
  const targetEmail = "amankumarschool7@gmail.com";
  const managerName = "Aman";
  const selectedDealerCodes = ["D23003", "D23007", "D23009", "D23008", "D23638", "D26927", "D24690"];

  const dues = database.dueRecords.filter((d) => {
    const code = (d.dealerCode || d.customerCode || "").trim();
    return selectedDealerCodes.includes(code);
  });

  console.log(`Found ${dues.length} dues for manager ${managerName}`);

  // Generate PDF
  console.log("Generating Manager Summary PDF...");
  const pdfBuffer = await generateSalespersonSummaryPDF(
    managerName,
    dues,
    [],
    database.reminderRules
  );
  console.log(`PDF generated successfully. Size: ${pdfBuffer.length} bytes`);
  fs.writeFileSync("scripts/manager-report-sample.pdf", pdfBuffer);
  console.log("Saved scripts/manager-report-sample.pdf");

  // Build HTML and Text
  const html = buildSalespersonSummaryHtml(managerName, dues, [], database.reminderRules);
  const text = buildSalespersonSummaryText(managerName, dues, [], database.reminderRules);

  const transporter = nodemailer.createTransport({
    host: settings.smtpHost,
    port: settings.smtpPort,
    secure: settings.smtpSecure,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 15000,
    auth: settings.smtpUser
      ? {
          user: settings.smtpUser,
          pass: settings.smtpPass
        }
      : undefined
  });

  console.log(`Sending Manager Report email to ${targetEmail}...`);
  const info = await transporter.sendMail({
    from: settings.senderEmail || settings.smtpFrom,
    to: [targetEmail],
    subject: `Manager Outstanding & Aging Report - ${managerName}`,
    text,
    html,
    attachments: [
      {
        filename: `Manager-Outstanding-Report-${managerName.toLowerCase()}.pdf`,
        content: pdfBuffer
      }
    ]
  });

  console.log("Email sent successfully! MessageId:", info.messageId);
}

run().catch((err) => {
  console.error("Failed to send manager report:", err);
  process.exit(1);
});
