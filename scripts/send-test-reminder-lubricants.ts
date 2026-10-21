import fs from "fs";
import path from "path";
import { MongoClient } from "mongodb";
import nodemailer from "nodemailer";
import { randomUUID } from "crypto";

// 1. Load .env.local
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

import { buildReminderEmailHtml } from "../lib/reminder-engine";
import { formatCurrency, formatDate } from "../lib/utils";

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI missing from environment");
  }

  const lubDbName = process.env.MONGODB_DB_LUBRICANTS || "auto-payment-reminder-lubricants";
  const targetRecipient = "amankumarschool7@gmail.com";
  console.log(`Connecting to MongoDB (${lubDbName})...`);

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(lubDbName);
  const collection = db.collection("app_state");

  const doc = await collection.findOne({ _id: "primary" });
  if (!doc) {
    throw new Error(`Database doc not found in ${lubDbName}`);
  }

  // Ensure collections exist
  doc.masterContacts = doc.masterContacts || [];
  doc.dueRecords = doc.dueRecords || [];
  doc.reminderLogs = doc.reminderLogs || [];
  doc.dispatchSettings = doc.dispatchSettings || [];

  const workspaceOwnerId = "company:arb-lubricants";
  const now = new Date();

  // 1. Configure or ensure contact exists
  let contact = doc.masterContacts.find((c: any) => c.email === targetRecipient);
  if (!contact) {
    contact = {
      id: "lub-contact-aman-01",
      ownerId: workspaceOwnerId,
      dealerCode: "LUB-D1001",
      customerCode: "LUB-D1001",
      companyName: "Aman Kumar Enterprises (ARB Lubricants Dealer)",
      primaryContact: "Aman Kumar Sah",
      email: targetRecipient,
      whatsapp: "+919999999999",
      sms: "+919999999999",
      alternateContact: "",
      notes: "Test contact for ARB Lubricants workspace",
      salespersonId: "sp-aman-01",
      salespersonName: "Aman Kumar",
      salespersonEmail: targetRecipient,
      backOfficeEmail: targetRecipient,
      importedAt: now.toISOString(),
      raw: {}
    };
    doc.masterContacts.push(contact);
    console.log("+ Created test contact in ARB Lubricants for:", targetRecipient);
  } else {
    contact.companyName = "Aman Kumar Enterprises (ARB Lubricants Dealer)";
    contact.primaryContact = "Aman Kumar Sah";
  }

  // 2. Dates for test invoices
  // Invoice 1: 30 days old (triggers 30-day Cash Discount reminder)
  const date30DaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const date15DaysAgo = new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000);
  // Invoice 2: 65 days old
  const date65DaysAgo = new Date(now.getTime() - 65 * 24 * 60 * 60 * 1000);
  const date40DaysAgo = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000);

  const testDue1 = {
    id: "lub-due-inv-101",
    ownerId: workspaceOwnerId,
    dealerCode: "LUB-D1001",
    customerCode: "LUB-D1001",
    companyName: contact.companyName,
    billDate: date30DaysAgo.toISOString(),
    invoiceNumber: "LUB/2026/INV-101",
    invoiceDate: date30DaysAgo.toISOString(),
    dueDate: date15DaysAgo.toISOString(),
    openingAmount: 48500,
    amount: 48500,
    quantity: 10,
    currency: "INR",
    overdueDays: 0,
    reference: "PO-LUB-001",
    notes: "High Grade Synthetic Lubricant - 200L Drum",
    matchedContactId: contact.id,
    matchedContactName: contact.primaryContact,
    matchedEmail: targetRecipient,
    matchedWhatsapp: "+919999999999",
    matchedSms: "+919999999999",
    contactMatchStatus: "matched",
    totalDueAmount: 76500,
    salespersonId: "sp-aman-01",
    salespersonName: "Aman Kumar",
    salespersonEmail: targetRecipient,
    lastReminderDate: now.toISOString(),
    reminderCount: 1,
    lastDispatchStatus: "pending",
    createdBy: workspaceOwnerId,
    updatedBy: workspaceOwnerId,
    importedAt: now.toISOString(),
    raw: {}
  };

  const testDue2 = {
    id: "lub-due-inv-095",
    ownerId: workspaceOwnerId,
    dealerCode: "LUB-D1001",
    customerCode: "LUB-D1001",
    companyName: contact.companyName,
    billDate: date65DaysAgo.toISOString(),
    invoiceNumber: "LUB/2026/INV-095",
    invoiceDate: date65DaysAgo.toISOString(),
    dueDate: date40DaysAgo.toISOString(),
    openingAmount: 28000,
    amount: 28000,
    quantity: 5,
    currency: "INR",
    overdueDays: 5,
    reference: "PO-LUB-000",
    notes: "Industrial Gear Oil - 50L Drum",
    matchedContactId: contact.id,
    matchedContactName: contact.primaryContact,
    matchedEmail: targetRecipient,
    matchedWhatsapp: "+919999999999",
    matchedSms: "+919999999999",
    contactMatchStatus: "matched",
    totalDueAmount: 76500,
    salespersonId: "sp-aman-01",
    salespersonName: "Aman Kumar",
    salespersonEmail: targetRecipient,
    lastReminderDate: now.toISOString(),
    reminderCount: 1,
    lastDispatchStatus: "pending",
    createdBy: workspaceOwnerId,
    updatedBy: workspaceOwnerId,
    importedAt: now.toISOString(),
    raw: {}
  };

  // Upsert dues in memory
  doc.dueRecords = doc.dueRecords.filter((d: any) => d.id !== testDue1.id && d.id !== testDue2.id);
  doc.dueRecords.push(testDue1, testDue2);

  const allDuesForDealer = [testDue1, testDue2];

  // 3. Find 30-Day Reminder Rule and Template
  const rule30 = doc.reminderRules.find((r: any) => r.triggerDay === 30) || doc.reminderRules[0];
  const template30 = doc.templates.find((t: any) => t.ruleId === rule30.id) || doc.templates[0];

  console.log(`Using Rule: "${rule30.name}" (triggerDay: ${rule30.triggerDay})`);

  // 4. Update and prepare Dispatch Settings
  // Use working SMTP credentials with "ARB Lubricants" sender display name
  const smtpConfig = {
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT || 465),
    secure: process.env.SMTP_SECURE === "true" || true,
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
    senderDisplay: `ARB Lubricants <${process.env.SMTP_USER || ""}>`,
    replyTo: process.env.SMTP_LUBRICANTS_USER || "arb.lubricants1@gmail.com"
  };

  // Ensure dispatchSettings in DB reflect enabled email
  let ds = doc.dispatchSettings.find((s: any) => s.ownerId === workspaceOwnerId);
  if (!ds) {
    ds = { ownerId: workspaceOwnerId };
    doc.dispatchSettings.push(ds);
  }
  ds.emailEnabled = true;
  ds.smtpHost = smtpConfig.host;
  ds.smtpPort = smtpConfig.port;
  ds.smtpSecure = smtpConfig.secure;
  ds.smtpUser = smtpConfig.user;
  ds.smtpPass = smtpConfig.pass;
  ds.senderEmail = smtpConfig.senderDisplay;
  ds.smtpFrom = smtpConfig.senderDisplay;
  ds.updatedAt = now.toISOString();

  // 5. Construct Reminder Content
  const invoiceNumber = testDue1.invoiceNumber;
  const currentInvoiceDue = testDue1.amount;
  const totalOutstanding = testDue1.amount + testDue2.amount;

  const subject = `Outstanding: Payment more than 30 days due in 5 days — Invoice ${invoiceNumber}`;
  const cdMessage = `Please note that a payment of ${formatCurrency(currentInvoiceDue, "INR")} is due within the next 5 days to avail the 3% CD benefit on the basic value of invoice ${invoiceNumber}.\n\nTo avail the 3% CD, please ensure that the payment is made before the invoice completes 30 days.`;

  const textContent = `Dear ${contact.primaryContact},\n\n${cdMessage}\n\nOutstanding Summary:\nCurrent outstanding: ${formatCurrency(currentInvoiceDue, "INR")}\nTotal outstanding: ${formatCurrency(totalOutstanding, "INR")}\n\nThank you for your attention in the matter.\n\nRegards,\nARB Lubricants`;

  const reminderLog: any = {
    id: randomUUID(),
    ownerId: workspaceOwnerId,
    dueId: testDue1.id,
    dedupeKey: `${testDue1.id}|${rule30.id}|email|manual|${now.toISOString()}`,
    contactId: contact.id,
    ruleId: rule30.id,
    templateId: template30.id,
    dealerCode: testDue1.dealerCode,
    invoiceNumber: testDue1.invoiceNumber,
    reminderDay: 30,
    billAgeDays: 30,
    cdEligible: true,
    cdPolicyId: "cd-30-policy",
    cdDiscountPercent: 3,
    cdReason: "Eligible for 3% cash discount",
    cdAmount: 48500,
    eligibleAmount: 48500,
    channel: "email",
    recipient: targetRecipient,
    scheduledFor: now.toISOString(),
    status: "pending",
    subject,
    content: textContent,
    failureReason: "",
    sentAt: "",
    createdAt: now.toISOString(),
    dealerName: contact.companyName,
    reminderType: rule30.name,
    selectedAgeingStage: `Manual Trigger (nominal: 30 days)`,
    invoiceIdsInvolved: [testDue1.id],
    relevantAmount: 48500,
    totalOutstanding,
    thresholdAmount: 10000
  };

  // 6. Generate Rich HTML Email via buildReminderEmailHtml
  console.log("Building HTML Email from ARB Lubricants engine...");
  const htmlContent = buildReminderEmailHtml(reminderLog, testDue1 as any, allDuesForDealer as any, doc);

  // 7. Send Email via Nodemailer
  console.log(`Sending reminder to ${targetRecipient}...`);
  const transporter = nodemailer.createTransport({
    host: smtpConfig.host,
    port: smtpConfig.port,
    secure: smtpConfig.secure,
    auth: {
      user: smtpConfig.user,
      pass: smtpConfig.pass
    }
  });

  const mailOptions = {
    from: smtpConfig.senderDisplay,
    to: targetRecipient,
    replyTo: smtpConfig.replyTo,
    subject: reminderLog.subject,
    text: reminderLog.content,
    html: htmlContent
  };

  const sendResult = await transporter.sendMail(mailOptions);
  console.log("Email dispatched successfully! Message ID:", sendResult.messageId);

  // 8. Update DB with 'sent' status
  reminderLog.status = "sent";
  reminderLog.sentAt = new Date().toISOString();
  testDue1.lastReminderDate = reminderLog.sentAt;
  testDue1.lastDispatchStatus = "sent";

  doc.reminderLogs.push(reminderLog);
  doc.auditLogs = doc.auditLogs || [];
  doc.auditLogs.push({
    id: randomUUID(),
    ownerId: workspaceOwnerId,
    timestamp: new Date().toISOString(),
    userId: "script-runner",
    userName: "System Administrator",
    userEmail: smtpConfig.replyTo,
    role: "super_admin",
    action: "Send Test Reminder",
    status: "success",
    details: `Dispatched test reminder for invoice ${testDue1.invoiceNumber} to ${targetRecipient} from ARB Lubricants workspace`
  });

  await collection.replaceOne({ _id: "primary" }, doc);
  console.log("Database updated with sent reminder record and audit entry.");
  console.log("\n========================================================");
  console.log("ARB Lubricants Test Reminder Successfully Sent!");
  console.log(`- Recipient: ${targetRecipient}`);
  console.log(`- Sender: ARB Lubricants (${smtpConfig.senderDisplay})`);
  console.log(`- Subject: ${reminderLog.subject}`);
  console.log(`- Invoice Number: ${testDue1.invoiceNumber}`);
  console.log(`- Current Invoice Amount: ₹${testDue1.amount}`);
  console.log(`- Total Outstanding (2 Invoices): ₹${totalOutstanding}`);
  console.log(`- Cash Discount: 3% (Avail within next 5 days)`);
  console.log(`- Message ID: ${sendResult.messageId}`);
  console.log("========================================================\n");

  await client.close();
}

main().catch((err) => {
  console.error("Execution failed:", err);
  process.exit(1);
});
