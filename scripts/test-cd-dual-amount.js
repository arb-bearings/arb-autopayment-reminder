const { evaluateCashDiscountEligibility, calculateDynamicDays, buildReminderEmailHtml } = require("../lib/reminder-engine");
const { formatCurrency, getBillAgeDays } = require("../lib/utils");

function runTest() {
  console.log("=== Testing CD Dual-Amount Logic ===");

  const refDate = new Date("2026-09-12T20:27:00Z");

  // Mock dues matching the image
  const dues = [
    {
      id: "inv-1",
      ownerId: "owner-1",
      companyName: "Nagpal Bearing Centre",
      dealerCode: "NAGPAL",
      invoiceNumber: "2207/30.06.2026/P-4",
      billDate: "2026-06-30",
      amount: 8364.19,
      currency: "INR"
    },
    {
      id: "inv-2",
      ownerId: "owner-1",
      companyName: "Nagpal Bearing Centre",
      dealerCode: "NAGPAL",
      invoiceNumber: "2851/24.07.2026/P-4/GREASE",
      billDate: "2026-07-24",
      amount: 4447.49,
      currency: "INR"
    },
    {
      id: "inv-3",
      ownerId: "owner-1",
      companyName: "Nagpal Bearing Centre",
      dealerCode: "NAGPAL",
      invoiceNumber: "3054/31.07.2026/P-4",
      billDate: "2026-07-31",
      amount: 6282.32,
      currency: "INR"
    },
    {
      id: "inv-4",
      ownerId: "owner-1",
      companyName: "Nagpal Bearing Centre",
      dealerCode: "NAGPAL",
      invoiceNumber: "3091/01.08.2026/P-4",
      billDate: "2026-08-01",
      amount: 1908.07,
      currency: "INR"
    },
    {
      id: "inv-5",
      ownerId: "owner-1",
      companyName: "Nagpal Bearing Centre",
      dealerCode: "NAGPAL",
      invoiceNumber: "2635/31.08.2026/P-2",
      billDate: "2026-08-31",
      amount: 46127.28,
      currency: "INR"
    },
    {
      id: "inv-6",
      ownerId: "owner-1",
      companyName: "Nagpal Bearing Centre",
      dealerCode: "NAGPAL",
      invoiceNumber: "3851/31.08.2026/P-4",
      billDate: "2026-08-31",
      amount: 125179.64,
      currency: "INR"
    }
  ];

  const policies = [
    {
      id: "cd-30",
      ownerId: "owner-1",
      name: "30 Day CD",
      paymentWindowDays: 30,
      discountPercent: 3,
      enabled: true,
      description: ""
    },
    {
      id: "cd-45",
      ownerId: "owner-1",
      name: "45 Day CD",
      paymentWindowDays: 45,
      discountPercent: 2,
      enabled: true,
      description: ""
    }
  ];

  // Test with inv-3 (31.07.2026, 43 days old on 12 Sep 2026)
  const evalResult = evaluateCashDiscountEligibility(dues[2], dues, policies, refDate, 45);

  console.log("\n[Scenario 1: With Older Invoices (Nagpal Bearing Centre)]");
  console.log("Eligible:", evalResult.eligible);
  console.log("Discount %:", evalResult.policy?.discountPercent);
  console.log("Has Older Unpaid:", evalResult.hasOlderUnpaid);
  console.log("CD Amount:", evalResult.cdAmount);
  console.log("Eligible Amount:", evalResult.eligibleAmount);
  console.log("Reason:", evalResult.reason);

  const expectedCdAmount = 6282.32 + 1908.07; // 8190.39
  const expectedEligibleAmount = 8364.19 + 4447.49 + 6282.32 + 1908.07; // 21002.07

  const cdMatch = Math.abs(evalResult.cdAmount - expectedCdAmount) < 0.01;
  const eligMatch = Math.abs(evalResult.eligibleAmount - expectedEligibleAmount) < 0.01;

  console.log(`\nCD Amount Matches ₹8,190.39: ${cdMatch ? "✅ PASS" : "❌ FAIL"}`);
  console.log(`Eligible Amount Matches ₹21,002.07: ${eligMatch ? "✅ PASS" : "❌ FAIL"}`);
  console.log(`Has Older Unpaid is true: ${evalResult.hasOlderUnpaid ? "✅ PASS" : "❌ FAIL"}`);

  // Test Scenario 2: Clean case without older invoices
  const cleanDues = dues.slice(2); // Only 31 Jul, 1 Aug, and 31 Aug
  const cleanEval = evaluateCashDiscountEligibility(cleanDues[0], cleanDues, policies, refDate, 45);

  console.log("\n[Scenario 2: Clean Case (No older unpaid invoices)]");
  console.log("Eligible:", cleanEval.eligible);
  console.log("Has Older Unpaid:", cleanEval.hasOlderUnpaid);
  console.log("CD Amount:", cleanEval.cdAmount);
  console.log("Eligible Amount:", cleanEval.eligibleAmount);
  console.log(`Has Older Unpaid is false: ${!cleanEval.hasOlderUnpaid ? "✅ PASS" : "❌ FAIL"}`);
  console.log(`CD Amount equals Eligible Amount: ${Math.abs(cleanEval.cdAmount - cleanEval.eligibleAmount) < 0.01 ? "✅ PASS" : "❌ FAIL"}`);

  if (cdMatch && eligMatch && evalResult.hasOlderUnpaid && !cleanEval.hasOlderUnpaid) {
    console.log("\n🎉 ALL TESTS PASSED!");
  } else {
    console.error("\n❌ TESTS FAILED");
    process.exit(1);
  }
}

runTest();
