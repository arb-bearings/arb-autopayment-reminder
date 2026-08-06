import PDFDocument from "pdfkit";
import { formatCurrency, formatDate, getBillAgeDays } from "@/lib/utils";
import type { DueRecord } from "@/lib/types";
import { evaluateCashDiscountEligibility } from "./reminder-engine";
import { getCompanyWorkspaceId } from "./company-workspace";

// Helper to format currency for PDFKit standard fonts (which do not support the Unicode Rupee symbol "₹")
function formatCurrencyForPdf(value: number, currency = "INR") {
  const formatted = formatCurrency(value, currency);
  return formatted.replace("₹", "Rs. ");
}

/**
 * Generates an A4 PDF outstanding statement.
 *
 * @param customerName  Display name for the customer
 * @param dealerCode    Dealer / customer code
 * @param dues          All outstanding due records for this dealer
 * @param totalAmount   Pre-computed total outstanding amount
 * @param currency      Currency code (default INR)
 * @param messageText   Optional reminder message body to render above the table
 */
export function generateOutstandingPDF(
  customerName: string,
  dealerCode: string,
  dues: DueRecord[],
  totalAmount: number,
  currency: string,
  messageText?: string,
  currentDueId?: string,
  ruleId?: string,
  database?: any
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      // Keep all pending invoices for the dealer (no 90 days limit)
      const activeTotalAmount = dues.reduce((sum, entry) => sum + (entry.amount || 0), 0);
      totalAmount = activeTotalAmount;

      const doc = new PDFDocument({ margin: 50, size: "A4" });
      const chunks: Buffer[] = [];

      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", (err) => reject(err));

      // ── Design tokens ──────────────────────────────────────────────────────
      const primaryColor   = "#1e293b"; // Sleek dark slate
      const secondaryColor = "#64748b"; // Medium slate grey
      const textColor      = "#0f172a"; // Almost black
      const borderColor    = "#cbd5e1"; // Light grey
      const warningRed     = "#b91c1c"; // Warning red
      const highlightBg    = "#fefce8"; // Soft yellow highlight for current invoice

      // ── 1. Document Header ─────────────────────────────────────────────────
      doc.fillColor(primaryColor)
         .fontSize(22)
         .font("Helvetica-Bold")
         .text("OUTSTANDING STATEMENT", 50, 50);

      doc.fontSize(8)
         .font("Helvetica")
         .fillColor(secondaryColor)
         .text(`Report Generated On: ${formatDate(new Date().toISOString())}`, 50, 75);

      // ── 2. Metadata Columns ────────────────────────────────────────────────
      doc.strokeColor(borderColor)
         .lineWidth(0.5)
         .moveTo(50, 100)
         .lineTo(545, 100)
         .stroke();

      doc.fillColor(primaryColor)
         .font("Helvetica-Bold")
         .fontSize(11)
         .text("CUSTOMER DETAILS", 50, 115);

      doc.font("Helvetica")
         .fontSize(10)
         .fillColor(textColor)
         .text(`Company Name : ${customerName}`, 50, 130);

      // ── 3. Three Summary Boxes (Total → Current Rule → Next Rule) ───────────
      const rules = database?.reminderRules;
      const activeTriggerDays: number[] = Array.from(
        new Set<number>(
          ((rules || []) as any[])
            .filter((r: any) => r.enabled)
            .map((r: any) => r.triggerDay as number)
            .filter((day: any) => typeof day === "number")
        )
      ).sort((a, b) => a - b); // ascending

      const sortedTriggerDays: number[] = activeTriggerDays.length > 0 ? activeTriggerDays : [30, 45, 60, 75, 80, 85, 90, 100, 110, 120];

      // Find current rule trigger day
      const currentRule = rules?.find((r: any) => r.id === ruleId);
      const matchedDue = currentDueId ? dues.find(d => d.id === currentDueId) : dues[0];
      // Engine fires 5 days before nominal day: nominal rule day = billAge + 5
      const rawBillAge = matchedDue ? (getBillAgeDays(matchedDue.billDate || matchedDue.invoiceDate, new Date()) || 0) : 0;
      const defaultDay = rawBillAge > 0 ? rawBillAge + 5 : 30;
      const currentRuleDay = currentRule ? currentRule.triggerDay : defaultDay;

      const today = new Date();
      let isCdEligible = false;
      if (matchedDue && database) {
        try {
          const workspaceUsers = database.users.filter(
            (u: any) => getCompanyWorkspaceId(u.companyName) === matchedDue.ownerId
          );
          const sharedOwnerIds = new Set<string>([
            matchedDue.ownerId,
            ...workspaceUsers.map((u: any) => u.id)
          ]);
          const policies = database.cashDiscountPolicies.filter(
            (p: any) => sharedOwnerIds.has(p.ownerId)
          );
          const evalResult = evaluateCashDiscountEligibility(
            matchedDue,
            dues,
            policies,
            today,
            currentRuleDay
          );
          isCdEligible = evalResult.eligible;
        } catch (e) {
          console.error("Failed to evaluate CD eligibility in PDF generator:", e);
        }
      }
       const box2Amount = matchedDue?.amount || 0;
       const currentInvoiceAge = getBillAgeDays(matchedDue?.billDate || matchedDue?.invoiceDate || "", today) || 0;

      // Find all other dues for this dealer (excluding the current invoice, must be older than current invoice)
      const otherDues = dues.filter((entry) => {
        if (entry.id === matchedDue?.id || !(entry.amount > 0)) return false;
        const entryAge = getBillAgeDays(entry.billDate || entry.invoiceDate, today) || 0;
        return entryAge > currentInvoiceAge;
      });

      // Box 2 Amount = sum of all other older invoices for this dealer
      const box3Amount = otherDues.reduce((sum, entry) => sum + (entry.amount || 0), 0);
      const box3Label = `PAYMENT MORE THAN ${currentRuleDay} DAYS`;

      // Total outstanding = sum of ALL dues for this dealer
      const calculatedTotalOutstanding = dues.reduce((sum, entry) => sum + (entry.amount || 0), 0);

      // Box 1 Label
      let box2Label = "";
      if (currentRuleDay <= 45) {
        box2Label = isCdEligible
          ? `PAYMENT DUE IN ${currentRuleDay} DAYS (FOR CD)`
          : `PAYMENT DUE IN ${currentRuleDay} DAYS`;
      } else {
        box2Label = `PAYMENT DUE IN ${currentRuleDay} DAYS`;
      }

      const boxWidth = 155;
      const boxHeight = 50;
      const boxY = 165;

      // ── Look up template overrides for this rule ────────────────────────────
      const rule = database?.reminderRules?.find((r: any) => r.id === ruleId);
      const ruleTemplate = database?.templates?.find((t: any) => (rule?.templateId ? t.id === rule.templateId : t.ruleId === ruleId));

      const show1 = (ruleTemplate?.pdfBox1Visible ?? rule?.pdfBox1Visible) !== false;  // default: show
      const show2 = (ruleTemplate?.pdfBox2Visible ?? rule?.pdfBox2Visible) !== false;
      const show3 = (ruleTemplate?.pdfBox3Visible ?? rule?.pdfBox3Visible) !== false;

      const label1 = (ruleTemplate?.pdfBox1Label || rule?.pdfBox1Label || "")?.trim() || box2Label;
      const label2 = (ruleTemplate?.pdfBox2Label || rule?.pdfBox2Label || "")?.trim() || box3Label;
      const label3 = (ruleTemplate?.pdfBox3Label || rule?.pdfBox3Label || "")?.trim() || "TOTAL OUTSTANDING";

      // ── Build array of only the visible boxes ───────────────────────────────
      type BoxConfig = { label: string; amount: number; color: string };
      const visibleBoxes: BoxConfig[] = [
        ...(show1 ? [{ label: label1, amount: box2Amount,                    color: textColor   }] : []),
        ...(show2 ? [{ label: label2, amount: box3Amount,                    color: "#b45309"   }] : []),
        ...(show3 ? [{ label: label3, amount: calculatedTotalOutstanding,    color: "#0f766e"   }] : []),
      ];

      // ── Compute positions so boxes are evenly spread across 50→545 ──────────
      const totalAvailable = 495; // 545 - 50
      const n = visibleBoxes.length;
      const gap = n > 1 ? (totalAvailable - n * boxWidth) / (n - 1) : 0;

      visibleBoxes.forEach((box, i) => {
        const boxX  = 50 + i * (boxWidth + gap);
        const textX = boxX + 8;

        doc.rect(boxX, boxY, boxWidth, boxHeight)
           .fillColor("#fafafa")
           .fill()
           .strokeColor(borderColor)
           .lineWidth(1)
           .stroke();
        doc.fillColor(primaryColor)
           .font("Helvetica-Bold")
           .fontSize(6.5)
           .text(box.label.toUpperCase(), textX, boxY + 12, { width: 140 });
        doc.fontSize(11)
           .fillColor(box.color)
           .text(formatCurrencyForPdf(box.amount, currency), textX, boxY + 26, { width: 140 });
      });


      let currentY = 230;

      // ── 4. Message Text (rendered above table when provided) ───────────────
      if (messageText && messageText.trim()) {
        doc.strokeColor(borderColor)
           .lineWidth(1)
           .moveTo(50, currentY)
           .lineTo(545, currentY)
           .stroke();

        currentY += 12;

        doc.fillColor(primaryColor)
           .font("Helvetica-Bold")
           .fontSize(11)
           .text("REMINDER NOTICE", 50, currentY);

        currentY += 16;

        // Strip HTML-style payment summary lines injected by the engine
        // and normalize Rupee symbol occurrences to "Rs. "
        const cleanText = messageText
          .replace(/Outstanding Summary:[\s\S]*$/i, "")
          .replace(/Payment Summary:[\s\S]*$/i, "")
          .replace(/Total outstanding:.*\n?/gi, "")
          .replace(/Previous outstanding:.*\n?/gi, "")
          .replace(/Current outstanding:.*\n?/gi, "")
          .replace(/Rs\.\s*₹/g, "Rs. ")
          .replace(/₹/g, "Rs. ")
          .replace(/Rs\.\s*Rs\./g, "Rs. ")
          .trim();

        doc.font("Helvetica")
           .fontSize(10)
           .fillColor(textColor);

        const lines = cleanText.split("\n");
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed === "") {
            currentY += 6; // blank line gap
          } else {
            doc.text(trimmed, 50, currentY, { width: 495 });
            currentY += doc.heightOfString(trimmed, { width: 495 }) + 4;
          }

          // Page overflow guard — add new page if needed
          if (currentY > 700) {
            doc.addPage();
            currentY = 50;
          }
        }

        currentY += 10;
      }

      // ── 5. Invoice Table ───────────────────────────────────────────────────
      const tableTop = currentY;

      doc.strokeColor(borderColor)
         .lineWidth(1)
         .moveTo(50, tableTop)
         .lineTo(545, tableTop)
         .stroke();

      // Table header background
      doc.rect(50, tableTop, 495, 20)
         .fillColor("#f1f5f9")
         .fill();

      // Column headers: Invoice Date | Invoice Number | Days Aged | Outstanding
      doc.fillColor(primaryColor)
         .font("Helvetica-Bold")
         .fontSize(9);

      doc.text("Invoice Date",   60,  tableTop + 6, { width: 100 });
      doc.text("Invoice Number", 170, tableTop + 6, { width: 130 });
      doc.text("Days Aged",      310, tableTop + 6, { width: 90 });
      doc.text("Outstanding",    410, tableTop + 6, { width: 125, align: "right" });

      doc.strokeColor(borderColor)
         .lineWidth(1)
         .moveTo(50, tableTop + 20)
         .lineTo(545, tableTop + 20)
         .stroke();

      // ── 6. Table Rows ──────────────────────────────────────────────────────
      currentY = tableTop + 20;
      doc.font("Helvetica").fontSize(9).fillColor("#334155");

      dues.forEach((due, index) => {
        const isCurrent = currentDueId ? due.id === currentDueId : index === 0;

        // Alternating row background; highlight the current invoice row
        if (isCurrent) {
          doc.rect(50, currentY, 495, 20)
             .fillColor(highlightBg)
             .fill();
        } else if (index % 2 === 1) {
          doc.rect(50, currentY, 495, 20)
             .fillColor("#f8fafc")
             .fill();
        }

        const invoiceText = due.invoiceNumber || due.reference || "-";
        const today = new Date();
        const billAge = getBillAgeDays(due.billDate || due.invoiceDate, today);
        const ageText = billAge !== null ? `${billAge} days` : "N/A";

        doc.fillColor(textColor)
           .font(isCurrent ? "Helvetica-Bold" : "Helvetica")
           .text(
             due.billDate || due.invoiceDate
               ? formatDate(due.billDate || due.invoiceDate)
               : "-",
             60,
             currentY + 6,
             { width: 100 }
           )
           .text(
             invoiceText,
             170,
             currentY + 6,
             { width: 130 }
           )
           .text(
             ageText,
             310,
             currentY + 6,
             { width: 90 }
           )
           .text(
             formatCurrencyForPdf(due.amount, due.currency || currency),
             410,
             currentY + 6,
             { width: 125, align: "right" }
           );

        currentY += 20;

        doc.strokeColor("#e2e8f0")
           .lineWidth(0.5)
           .moveTo(50, currentY)
           .lineTo(545, currentY)
           .stroke();

        // Page overflow guard
        if (currentY > 700) {
          doc.addPage();
          currentY = 50;
        }
      });

      // ── 7. Total Row ───────────────────────────────────────────────────────
      doc.rect(50, currentY, 495, 22)
         .fillColor("#f1f5f9")
         .fill();

      doc.fillColor(primaryColor)
         .font("Helvetica-Bold")
         .text("Total Outstanding", 60, currentY + 6)
         .text(formatCurrencyForPdf(totalAmount, currency), 410, currentY + 6, {
           width: 125,
           align: "right"
         });

      doc.strokeColor(borderColor)
         .lineWidth(1)
         .moveTo(50, currentY + 22)
         .lineTo(545, currentY + 22)
         .stroke();

      // ── 8. Footer ──────────────────────────────────────────────────────────
      const footerY = Math.min(currentY + 50, 750);

      doc.strokeColor(borderColor)
         .lineWidth(0.5)
         .moveTo(50, footerY)
         .lineTo(545, footerY)
         .stroke();

      doc.fontSize(8)
         .font("Helvetica")
         .fillColor(secondaryColor)
         .text(
           "This is an automatically generated document. Thank you for your cooperation.",
           50,
           footerY + 10,
           { align: "center" }
         );

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

export function generateSalespersonSummaryPDF(
  name: string,
  dues: DueRecord[],
  sentLogs: any[],
  rules: any[]
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50, size: "A4" });
      const chunks: Buffer[] = [];

      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", (err) => reject(err));

      const primaryColor   = "#0f766e"; // Teal matching salesperson summary color
      const secondaryColor = "#64748b";
      const textColor      = "#0f172a";
      const borderColor    = "#cbd5e1";

      // 1. Title / Header
      doc.fillColor(primaryColor)
         .fontSize(20)
         .font("Helvetica-Bold")
         .text("SALESPERSON REMINDER SUMMARY", 50, 50);

      doc.fontSize(8)
         .font("Helvetica")
         .fillColor(secondaryColor)
         .text(`Report Date: ${formatDate(new Date().toISOString())}`, 50, 75);

      // Metadata section
      doc.strokeColor(borderColor)
         .lineWidth(0.5)
         .moveTo(50, 95)
         .lineTo(545, 95)
         .stroke();

      doc.fillColor(textColor)
         .font("Helvetica-Bold")
         .fontSize(11)
         .text(`Salesperson: ${name}`, 50, 105);

      // Summary Table metrics
      const uniqueDealers = Array.from(new Set(dues.map(d => d.companyName || d.dealerCode).filter(Boolean)));
      const totalOutstanding = dues.reduce((sum, d) => sum + (d.amount || 0), 0);
      const currency = dues[0]?.currency || "INR";

      const cdLogs = sentLogs.filter(log => log.cdEligible);
      const cdDueIds = new Set(cdLogs.map(log => log.dueId).filter(Boolean));
      const cdDues = dues.filter(due => cdDueIds.has(due.id));
      const cdOutstanding = cdDues.reduce((sum, d) => sum + (d.amount || 0), 0);

      const over90Logs = sentLogs.filter(log => (log.reminderDay || 0) > 90);
      const over90DueIds = new Set(over90Logs.map(log => log.dueId).filter(Boolean));
      const over90Dues = dues.filter(due => over90DueIds.has(due.id));
      const over90Outstanding = over90Dues.reduce((sum, d) => sum + (d.amount || 0), 0);

      // Render Summary Table
      let currentY = 125;
      
      // Draw Table background
      doc.rect(50, currentY, 495, 18)
         .fillColor("#f8fafc")
         .fill();

      doc.fillColor(textColor)
         .font("Helvetica-Bold")
         .fontSize(8.5);

      doc.text("Metric", 60, currentY + 5, { width: 230 });
      doc.text("Count", 300, currentY + 5, { width: 80, align: "center" });
      doc.text("Outstanding", 400, currentY + 5, { width: 135, align: "right" });

      doc.strokeColor(borderColor)
         .lineWidth(0.5)
         .moveTo(50, currentY + 18)
         .lineTo(545, currentY + 18)
         .stroke();

      currentY += 18;

      // Row 1: Total Assigned Dealers
      doc.fillColor(textColor)
         .font("Helvetica")
         .fontSize(8)
         .text("Total Assigned Dealers", 60, currentY + 5)
         .text(uniqueDealers.length.toString(), 300, currentY + 5, { width: 80, align: "center" })
         .text(formatCurrencyForPdf(totalOutstanding, currency), 400, currentY + 5, { width: 135, align: "right" });

      currentY += 18;
      doc.strokeColor("#f1f5f9")
         .lineWidth(0.5)
         .moveTo(50, currentY)
         .lineTo(545, currentY)
         .stroke();

      // Row 2: Due in CD
      doc.text("Due in CD", 60, currentY + 5)
         .text(cdLogs.length.toString(), 300, currentY + 5, { width: 80, align: "center" })
         .text(formatCurrencyForPdf(cdOutstanding, currency), 400, currentY + 5, { width: 135, align: "right" });

      currentY += 18;
      doc.strokeColor("#f1f5f9")
         .lineWidth(0.5)
         .moveTo(50, currentY)
         .lineTo(545, currentY)
         .stroke();

      // Row 3: Due Above 90 Days
      doc.text("Due Above 90 Days", 60, currentY + 5)
         .text(over90Logs.length.toString(), 300, currentY + 5, { width: 80, align: "center" })
         .text(formatCurrencyForPdf(over90Outstanding, currency), 400, currentY + 5, { width: 135, align: "right" });

      currentY += 18;
      doc.strokeColor(borderColor)
         .lineWidth(1)
         .moveTo(50, currentY)
         .lineTo(545, currentY)
         .stroke();

      currentY += 15;

      doc.fillColor(textColor)
         .font("Helvetica-Bold")
         .fontSize(12)
         .text("Dealer Aging Breakdown", 50, currentY);

      currentY += 18;

      // Calculate brackets
      const brackets = [
        { label: "More than 180 Days", min: 181, max: Infinity },
        { label: "Between 120 and 180 Days", min: 121, max: 180 },
        { label: "Between 90 and 120 Days", min: 91, max: 120 },
        { label: "90 Days", min: 90, max: 90 },
        { label: "75 Days", min: 75, max: 89 },
        { label: "60 Days", min: 60, max: 74 },
        { label: "45 Days", min: 45, max: 59 },
        { label: "30 Days", min: 30, max: 44 }
      ];

      // Render each section
      brackets.forEach((bracket) => {
        const matchingRules = (rules || []).filter(r => r.triggerDay >= bracket.min && r.triggerDay <= bracket.max);
        const ruleIds = matchingRules.map(r => r.id);
        const ruleLogs = sentLogs.filter(log => ruleIds.includes(log.ruleId) || (log.reminderDay >= bracket.min && log.reminderDay <= bracket.max));

        // Only show sections with activity today
        if (ruleLogs.length === 0) {
          return;
        }

        const ruleLabel = bracket.label;
        const ruleDealerCodes = Array.from(new Set(ruleLogs.map(log => log.dealerCode).filter(Boolean)));
        const assignedDealersCount = ruleDealerCodes.length;
        const sentTodayCount = ruleLogs.length;
        const matchingDueIds = ruleLogs.map(log => log.dueId).filter(Boolean);
        const ruleDues = dues.filter(due => matchingDueIds.includes(due.id));
        const paymentDueAmount = ruleDues.reduce((sum, d) => sum + (d.amount || 0), 0);

        // Group by dealer
        const dealerMap = new Map<string, typeof ruleDues>();
        for (const due of ruleDues) {
          const key = due.companyName || due.dealerCode || "Unknown";
          if (!dealerMap.has(key)) dealerMap.set(key, []);
          dealerMap.get(key)!.push(due);
        }

        // Draw section title
        if (currentY > 650) {
          doc.addPage();
          currentY = 50;
        }

        doc.fillColor(primaryColor)
           .font("Helvetica-Bold")
           .fontSize(10.5)
           .text(`Dealers in ${ruleLabel}`, 50, currentY);

        currentY += 14;

        // Draw sub-metric boxes for the bracket
        const subBoxWidth = 155;
        const subBoxHeight = 35;

        // Sub box 1
        doc.rect(50, currentY, subBoxWidth, subBoxHeight)
           .fillColor("#fcfcfc")
           .fill()
           .strokeColor(borderColor)
           .lineWidth(0.5)
           .stroke();
        doc.fillColor(secondaryColor)
           .font("Helvetica-Bold")
           .fontSize(6)
           .text("ASSIGNED DEALERS", 56, currentY + 8);
        doc.fontSize(10)
           .fillColor(textColor)
           .text(assignedDealersCount.toString(), 56, currentY + 18);

        // Sub box 2
        doc.rect(220, currentY, subBoxWidth, subBoxHeight)
           .fillColor("#fcfcfc")
           .fill()
           .strokeColor(borderColor)
           .lineWidth(0.5)
           .stroke();
        doc.fillColor(secondaryColor)
           .font("Helvetica-Bold")
           .fontSize(6)
           .text(`PAYMENT DUE (${bracket.label.toUpperCase()})`, 226, currentY + 8);
        doc.fontSize(10)
           .fillColor(primaryColor)
           .text(formatCurrencyForPdf(paymentDueAmount, currency), 226, currentY + 18);

        // Sub box 3
        doc.rect(390, currentY, subBoxWidth, subBoxHeight)
           .fillColor("#fcfcfc")
           .fill()
           .strokeColor(borderColor)
           .lineWidth(0.5)
           .stroke();
        doc.fillColor(secondaryColor)
           .font("Helvetica-Bold")
           .fontSize(6)
           .text("REMINDERS SENT TODAY", 396, currentY + 8);
        doc.fontSize(10)
           .fillColor("#b45309")
           .text(sentTodayCount.toString(), 396, currentY + 18);

        currentY += subBoxHeight + 12;

        // Draw Table Header
        if (currentY > 700) {
          doc.addPage();
          currentY = 50;
        }

        // Draw Table background
        doc.rect(50, currentY, 495, 18)
           .fillColor("#f8fafc")
           .fill();

        doc.fillColor(textColor)
           .font("Helvetica-Bold")
           .fontSize(8);

        doc.text("Dealer",            60,  currentY + 5, { width: 140 });
        doc.text("No. of Invoices",   200, currentY + 5, { width: 70, align: "center" });
        doc.text("Due Date",          280, currentY + 5, { width: 85 });
        doc.text("Invoice No.",       375, currentY + 5, { width: 85 });
        doc.text("Outstanding",       460, currentY + 5, { width: 75, align: "right" });

        doc.strokeColor(borderColor)
           .lineWidth(0.5)
           .moveTo(50, currentY + 18)
           .lineTo(545, currentY + 18)
           .stroke();

        currentY += 18;

        // Draw Table Rows
        let rowIndex = 0;
        dealerMap.forEach((groupDues, dealerName) => {
          if (currentY > 730) {
            doc.addPage();
            currentY = 50;

            // Redraw table headers on new page
            doc.rect(50, currentY, 495, 18)
               .fillColor("#f8fafc")
               .fill();
            doc.fillColor(textColor).font("Helvetica-Bold").fontSize(8);
            doc.text("Dealer",            60,  currentY + 5, { width: 140 });
            doc.text("No. of Invoices",   200, currentY + 5, { width: 70, align: "center" });
            doc.text("Due Date",          280, currentY + 5, { width: 85 });
            doc.text("Invoice No.",       375, currentY + 5, { width: 85 });
            doc.text("Outstanding",       460, currentY + 5, { width: 75, align: "right" });

            doc.strokeColor(borderColor)
               .lineWidth(0.5)
               .moveTo(50, currentY + 18)
               .lineTo(545, currentY + 18)
               .stroke();

            currentY += 18;
          }

          // Row background
          if (rowIndex % 2 === 1) {
            doc.rect(50, currentY, 495, 18)
               .fillColor("#fafafa")
               .fill();
          }

          const dealerAllDuesCount = dues.filter(
            (d) => (d.companyName || d.dealerCode) === dealerName
          ).length;
          const dueDates = groupDues.map(d => d.dueDate ? formatDate(d.dueDate) : "-").join(", ");
          const invoiceNos = groupDues.map(d => d.invoiceNumber || d.reference || "-").join(", ");
          const totalOutstanding = groupDues.reduce((sum, d) => sum + (d.amount || 0), 0);

          doc.fillColor(textColor)
             .font("Helvetica")
             .fontSize(7.5)
             .text(dealerName, 60, currentY + 5, { width: 140, height: 10, ellipsis: true })
             .text(dealerAllDuesCount.toString(), 200, currentY + 5, { width: 70, align: "center" })
             .text(dueDates, 280, currentY + 5, { width: 85, height: 10, ellipsis: true })
             .text(invoiceNos, 375, currentY + 5, { width: 85, height: 10, ellipsis: true })
             .text(formatCurrencyForPdf(totalOutstanding, currency), 460, currentY + 5, { width: 75, align: "right" });

          currentY += 18;

          doc.strokeColor("#f1f5f9")
             .lineWidth(0.5)
             .moveTo(50, currentY)
             .lineTo(545, currentY)
             .stroke();

          rowIndex++;
        });

        currentY += 20; // gap before next aging bracket section
      });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
