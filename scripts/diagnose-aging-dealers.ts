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
        process.env[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
      }
    }
  }
} catch (e) {}

import { readDatabase } from "../lib/storage";
import { getBillAgeDays } from "../lib/utils";

async function main() {
  const db = await readDatabase();
  const dues = (db.dueRecords || []).filter(d => (d.amount || 0) > 0);
  const today = new Date();

  console.log("Total dues:", dues.length);

  // Group by dealer key matching reports.ts
  const dealerMap = new Map<string, { name: string; dues: typeof dues; oldestAge: number }>();
  for (const due of dues) {
    const key = (due.companyName || due.dealerCode || due.customerCode || "Unknown").trim();
    const age = getBillAgeDays(due.billDate || due.invoiceDate, today) ?? 0;
    const existing = dealerMap.get(key);
    if (!existing) {
      dealerMap.set(key, { name: key, dues: [due], oldestAge: age });
    } else {
      existing.dues.push(due);
      if (age > existing.oldestAge) existing.oldestAge = age;
    }
  }

  console.log("Total unique dealers in map:", dealerMap.size);

  const agingBuckets = [
    { label: "DEALERS MORE THAN 180 DAYS", min: 181, max: Infinity },
    { label: "DEALERS BETWEEN 120 – 180 DAYS", min: 121, max: 180 },
    { label: "DEALERS BETWEEN 90 – 120 DAYS", min: 91, max: 120 },
    { label: "DEALERS IN 90 DAYS", min: 90, max: 90 },
    { label: "DEALERS IN 75 DAYS", min: 75, max: 89 },
    { label: "DEALERS IN 60 DAYS", min: 60, max: 74 },
    { label: "DEALERS IN 45 DAYS", min: 45, max: 59 },
    { label: "DEALERS IN 30 DAYS", min: 30, max: 44 },
  ];

  const assignedDealers = new Set<string>();
  let totalBucketCount = 0;
  let totalBucketAmount = 0;

  for (const b of agingBuckets) {
    const matched = Array.from(dealerMap.values()).filter(d => d.oldestAge >= b.min && d.oldestAge <= b.max);
    matched.forEach(d => assignedDealers.add(d.name));
    const amt = matched.reduce((sum, d) => sum + d.dues.reduce((s, due) => s + (due.amount || 0), 0), 0);
    totalBucketCount += matched.length;
    totalBucketAmount += amt;
    console.log(`${b.label}: ${matched.length} dealers, amount: ₹${amt.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`);
  }

  console.log(`\nSum of bucket dealers: ${totalBucketCount}`);
  console.log(`Total dealers in dealerMap: ${dealerMap.size}`);

  const unassigned = Array.from(dealerMap.values()).filter(d => !assignedDealers.has(d.name));
  console.log(`\nUnassigned dealers count: ${unassigned.length}`);
  console.log("Breakdown of unassigned dealers by oldestAge:");

  const lessThan30 = unassigned.filter(d => d.oldestAge < 30);
  const otherUnassigned = unassigned.filter(d => d.oldestAge >= 30);

  console.log(`  Dealers with oldestAge < 30 days: ${lessThan30.length}`);
  const lessThan30Amt = lessThan30.reduce((sum, d) => sum + d.dues.reduce((s, due) => s + (due.amount || 0), 0), 0);
  console.log(`  Total outstanding for < 30 days: ₹${lessThan30Amt.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`);

  if (otherUnassigned.length > 0) {
    console.log(`  Other unassigned (age >= 30): ${otherUnassigned.length}`);
    for (const d of otherUnassigned) {
      console.log(`    - ${d.name}: oldestAge = ${d.oldestAge}`);
    }
  }

  console.log("\nSample of < 30 days dealers (first 10):");
  for (const d of lessThan30.slice(0, 10)) {
    console.log(`  - ${d.name}: oldestAge = ${d.oldestAge} days, dues count = ${d.dues.length}`);
  }
}

main().catch(console.error);
