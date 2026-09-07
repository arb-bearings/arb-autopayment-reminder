import fs from "fs";
import path from "path";
import { MongoClient } from "mongodb";
import { generateRemindersForUser } from "../lib/reminder-engine";

// Helper to load env vars
function loadEnv() {
  const envPath = path.join(__dirname, "../.env.local");
  if (!fs.existsSync(envPath)) {
    throw new Error(".env.local not found");
  }
  const content = fs.readFileSync(envPath, "utf8");
  const env: Record<string, string> = {};
  content.split("\n").forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const match = trimmed.match(/^([^=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      const val = match[2].trim();
      env[key] = val;
      process.env[key] = val;
    }
  });
  return env;
}

async function test() {
  const env = loadEnv();
  const client = new MongoClient(env.MONGODB_URI);
  await client.connect();

  const db = client.db(env.MONGODB_DB || "auto-payment-reminder");
  const collectionName = env.MONGODB_COLLECTION || "app_state";
  const collection = db.collection(collectionName);

  // 1. Fetch initial primary document
  const doc = await collection.findOne({ _id: "primary" });
  if (!doc) {
    console.error("No primary document found!");
    await client.close();
    return;
  }

  // Backup primary document
  const backup = JSON.parse(JSON.stringify(doc));

  try {
    console.log("--- Starting Reminder range and silence window tests ---");

    // Clear existing logs and setup test dues
    const user = doc.users[0];
    if (!user) {
      throw new Error("No user found in DB to run tests under.");
    }

    console.log(`Using user: ${user.email} (ID: ${user.id})`);

    // Let's create a test due record for a specific dealer code: TEST_DEALER
    // Today's date
    const today = new Date();
    // Bill date 27 days ago (to get billAgeDays = 27)
    const billDate = new Date(today.getTime() - 27 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    console.log(`Setting up test invoice with bill date: ${billDate} (27 days ago)`);

    const testDue = {
      id: "test-due-1",
      ownerId: user.id,
      dealerCode: "TEST_DEALER",
      customerCode: "TEST_DEALER",
      companyName: "Test Dealer Inc",
      billDate: billDate,
      invoiceNumber: "INV-TEST-001",
      invoiceDate: billDate,
      dueDate: new Date(today.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      openingAmount: 10000,
      amount: 10000,
      currency: "INR",
      overdueDays: 0,
      reference: "INV-TEST-001",
      notes: "Test invoice",
      matchedContactId: "test-contact-1",
      matchedContactName: "Test Dealer Inc",
      matchedEmail: "test-dealer@example.com",
      matchedWhatsapp: "+919999999999",
      matchedSms: "+919999999999",
      contactMatchStatus: "matched" as const,
      totalDueAmount: 10000,
      salespersonId: "",
      salespersonName: "",
      salespersonEmail: "",
      lastReminderDate: "",
      reminderCount: 0,
      lastDispatchStatus: "",
      createdBy: user.id,
      updatedBy: user.id,
      importedAt: new Date().toISOString(),
      raw: {}
    };

    const testContact = {
      id: "test-contact-1",
      ownerId: user.id,
      dealerCode: "TEST_DEALER",
      customerCode: "TEST_DEALER",
      companyName: "Test Dealer Inc",
      primaryContact: "John Doe",
      email: "test-dealer@example.com",
      whatsapp: "+919999999999",
      sms: "+919999999999",
      alternateContact: "",
      notes: "",
      salespersonId: "",
      salespersonName: "",
      salespersonEmail: "",
      importedAt: new Date().toISOString(),
      raw: {}
    };

    // Ensure we have a 30-day rule enabled
    let rule30 = doc.reminderRules.find((r: any) => r.ownerId === user.id && r.triggerDay === 30);
    if (!rule30) {
      console.log("No 30-day rule found, creating one...");
      rule30 = {
        id: "rule-30-day",
        ownerId: user.id,
        name: "30 Day Reminder",
        triggerDay: 30,
        enabled: true,
        autoSend: false,
        channels: { email: true, whatsapp: true, sms: false },
        templateId: doc.templates.find((t: any) => t.ownerId === user.id)?.id || "template-1",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      doc.reminderRules.push(rule30);
    } else {
      rule30.enabled = true;
    }

    // Set dues, contacts, and clear logs in document
    doc.dueRecords = [testDue];
    doc.masterContacts = [testContact];
    doc.reminderLogs = [];

    await collection.replaceOne({ _id: "primary" }, doc);

    // Run first generation!
    console.log("\n--- Run 1: Generating reminders for age = 27 ---");
    let generated = await generateRemindersForUser(user.id, today.toISOString());
    console.log(`Generated ${generated.length} reminders.`);
    
    // Check if the generated log contains our 30-day rule reminder
    const dbDocAfterRun1 = await collection.findOne({ _id: "primary" });
    const pendingLogsRun1 = dbDocAfterRun1?.reminderLogs || [];
    console.log(`Pending reminder logs count in DB: ${pendingLogsRun1.length}`);
    pendingLogsRun1.forEach((l: any) => {
      console.log(`- Rule: ${l.reminderDay} Day, Dealer: ${l.dealerCode}, Age: ${l.billAgeDays}, Status: ${l.status}`);
    });

    if (pendingLogsRun1.length === 0) {
      throw new Error("No reminders generated on run 1! Evaluation failed.");
    }

    // 2. Mark reminder as "sent" with sentAt = today
    console.log("\n--- Simulating sending the reminder today ---");
    await collection.updateOne(
      { _id: "primary", "reminderLogs.status": "pending" },
      { $set: { "reminderLogs.$.status": "sent", "reminderLogs.$.sentAt": today.toISOString() } }
    );

    // Run second generation today
    console.log("\n--- Run 2: Re-generating reminders today (should skip due to sent log within 5 days) ---");
    let generatedRun2 = await generateRemindersForUser(user.id, today.toISOString());
    console.log(`Generated ${generatedRun2.length} reminders.`);

    const dbDocAfterRun2 = await collection.findOne({ _id: "primary" });
    const pendingLogsRun2 = (dbDocAfterRun2?.reminderLogs || []).filter((l: any) => l.status === "pending");
    console.log(`Pending reminder logs count in DB: ${pendingLogsRun2.length}`);
    if (pendingLogsRun2.length > 0) {
      throw new Error("Duplicate reminder generated! Silence check failed.");
    }
    console.log("Success: Duplicate check correctly skipped generation!");

    // 3. Move time forward by 3 days (simulated)
    const futureDate = new Date(today.getTime() + 3 * 24 * 60 * 60 * 1000);
    // age will now be 30
    console.log(`\n--- Run 3: Simulating 3 days in the future (invoice age = 30) ---`);
    console.log(`Current simulated age: 30 days. Log sent date was 3 days ago.`);
    let generatedRun3 = await generateRemindersForUser(user.id, futureDate.toISOString());
    console.log(`Generated ${generatedRun3.length} reminders.`);

    const dbDocAfterRun3 = await collection.findOne({ _id: "primary" });
    const pendingLogsRun3 = (dbDocAfterRun3?.reminderLogs || []).filter((l: any) => l.status === "pending");
    console.log(`Pending reminder logs count in DB: ${pendingLogsRun3.length}`);
    if (pendingLogsRun3.length > 0) {
      throw new Error("Reminder generated too early! 5-day silence window failed.");
    }
    console.log("Success: Silence check correctly blocked generation on Day 3!");

    // 4. Move time forward by 6 days (simulated)
    const futureDateDay6 = new Date(today.getTime() + 6 * 24 * 60 * 60 * 1000);
    // age will now be 33
    console.log(`\n--- Run 4: Simulating 6 days in the future (invoice age = 33) ---`);
    console.log(`Current simulated age: 33 days. Log sent date was 6 days ago.`);
    let generatedRun4 = await generateRemindersForUser(user.id, futureDateDay6.toISOString());
    console.log(`Generated ${generatedRun4.length} reminders.`);

    const dbDocAfterRun4 = await collection.findOne({ _id: "primary" });
    const pendingLogsRun4 = (dbDocAfterRun4?.reminderLogs || []).filter((l: any) => l.status === "pending");
    console.log(`Pending reminder logs count in DB: ${pendingLogsRun4.length}`);
    if (pendingLogsRun4.length === 0) {
      throw new Error("No reminder generated after silence period! Expected reminder generation on Day 6.");
    }
    console.log("Success: Reminder generated successfully after 5-day silence window passed!");

    console.log("\n✅ All tests passed successfully!");
  } finally {
    // Restore backup
    console.log("\nRestoring backup of primary state...");
    await collection.replaceOne({ _id: "primary" }, backup);
    await client.close();
  }
}

test().catch(console.error);
