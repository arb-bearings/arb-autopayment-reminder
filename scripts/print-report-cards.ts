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
import { buildDailyActivityReport } from "../lib/reports";

async function main() {
  const db = await readDatabase();
  const user = db.users.find(u => u.email === "arbbearings.marketing@gmail.com" || u.role === "super_admin") || db.users[0];
  const report = await buildDailyActivityReport(user, new Date());
  
  const regex = /<div class="metric-label"[^>]*>([\s\S]*?)<\/div>\s*<div class="metric-value"[^>]*>([\s\S]*?)<\/div>/g;
  let match;
  console.log("=== EXTRACTED OWNER REPORT CARDS ===");
  while ((match = regex.exec(report.html)) !== null) {
    const label = match[1].replace(/<[^>]+>/g, "").trim();
    const val = match[2].replace(/<[^>]+>/g, "").trim();
    console.log(`${label} => ${val}`);
  }
}

main().catch(console.error);
