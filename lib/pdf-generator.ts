import PDFDocument from "pdfkit";
import { formatCurrency, formatDate, getBillAgeDays } from "@/lib/utils";
import type { DueRecord } from "@/lib/types";
import { evaluateCashDiscountEligibility, calculateDynamicDays, calculateRuleOutstanding } from "./reminder-engine";
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
       // Box 1 Amount = CD bucket amount for CD rules, or relevant amount / rule stage dues
       const matchingLog = database?.reminderLogs?.find(
         (l: any) => (l.dueId === currentDueId && l.ruleId === ruleId) || l.id === currentDueId
       );
       let box2Amount = matchingLog?.cdAmount;
       if (box2Amount === undefined || box2Amount === null) {
         if (currentRuleDay === 30 || currentRuleDay === 45) {
           box2Amount = calculateRuleOutstanding(dues, currentRuleDay, today);
         } else {
           box2Amount = matchingLog?.relevantAmount ?? calculateRuleOutstanding(dues, currentRuleDay, today);
         }
       }
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
      if (currentRuleDay === 30) {
        const daysVal = calculateDynamicDays(currentInvoiceAge, 30);
        box2Label = `PAYMENT DUE IN ${daysVal} DAYS TO AVAIL 3% CD`;
      } else if (currentRuleDay === 45) {
        const daysVal = calculateDynamicDays(currentInvoiceAge, 45);
        box2Label = `PAYMENT DUE IN ${daysVal} DAYS TO AVAIL 2% CD`;
      } else {
        const daysVal = calculateDynamicDays(currentInvoiceAge, currentRuleDay);
        box2Label = `PAYMENT DUE IN ${daysVal} DAYS`;
      }

      const boxWidth = 155;
      const boxHeight = 50;
      const boxY = 165;

      // ── Look up template overrides for this rule ────────────────────────────
      const rule = database?.reminderRules?.find((r: any) => r.id === ruleId);
      const ruleTemplate = database?.templates?.find((t: any) => (rule?.templateId ? t.id === rule.templateId : t.ruleId === ruleId));

      const show1 = (ruleTemplate?.pdfBox1Visible ?? rule?.pdfBox1Visible) !== false;  // default: show
      const show3 = (ruleTemplate?.pdfBox3Visible ?? rule?.pdfBox3Visible) !== false;

      const label1 = (ruleTemplate?.pdfBox1Label || rule?.pdfBox1Label || "")?.trim() || box2Label;
      const label3 = (ruleTemplate?.pdfBox3Label || rule?.pdfBox3Label || "")?.trim() || "TOTAL OUTSTANDING";

      // ── Build array of only the visible boxes ───────────────────────────────
      type BoxConfig = { label: string; amount: number; color: string };
      const visibleBoxes: BoxConfig[] = [
        ...(show1 ? [{ label: label1, amount: box2Amount,                    color: textColor   }] : []),
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

        const invoiceText = due.invoiceNumber || due.reference || "-";
        const today = new Date();
        const billAge = getBillAgeDays(due.billDate || due.invoiceDate, today);
        const ageText = billAge !== null ? `${billAge} days` : "N/A";

        // Color code background based on overdue status (red if age > 60, green otherwise)
        const isOverdue = (billAge || 0) > 60;
        const rowBg = isOverdue ? "#fef2f2" : "#f0fdf4"; // Light red / light green

        doc.rect(50, currentY, 495, 20)
           .fillColor(rowBg)
           .fill();

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
  sentLogs: any[] = [],
  rules: any[] = []
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 40, size: "A4" });
      const chunks: Buffer[] = [];

      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", (err) => reject(err));

      const primaryColor   = "#0f766e"; // Teal
      const secondaryColor = "#64748b"; // Slate grey
      const textColor      = "#0f172a"; // Dark slate
      const borderColor    = "#cbd5e1"; // Light border
      const warningRed     = "#b91c1c";
      const warningAmber   = "#b45309";
      const cdGreen        = "#15803d";

      const today = new Date();
      const currency = dues[0]?.currency || "INR";
      const totalOutstanding = dues.reduce((sum, d) => sum + (d.amount || 0), 0);
      const totalInvoicesCount = dues.length;

      // Group by unique dealer
      const dealerMap = new Map<string, DueRecord[]>();
      for (const due of dues) {
        const dealerKey = (due.companyName || due.dealerCode || "Unknown Dealer").trim();
        if (!dealerMap.has(dealerKey)) {
          dealerMap.set(dealerKey, []);
        }
        dealerMap.get(dealerKey)!.push(due);
      }
      const uniqueDealersCount = dealerMap.size;

      // 1. Title / Header
      doc.fillColor(primaryColor)
         .fontSize(18)
         .font("Helvetica-Bold")
         .text("MANAGER OUTSTANDING & AGING REPORT", 40, 40);

      doc.fontSize(8.5)
         .font("Helvetica")
         .fillColor(secondaryColor)
         .text(
           `Report Date: ${formatDate(today.toISOString())}   |   Manager: ${name}   |   Total Dealers: ${uniqueDealersCount}   |   Total Invoices: ${totalInvoicesCount}`,
           40,
           64
         );

      doc.strokeColor(borderColor)
         .lineWidth(0.5)
         .moveTo(40, 78)
         .lineTo(555, 78)
         .stroke();

      // 2. Executive KPI Cards (Top 3 boxes)
      const boxWidth = 165;
      const boxHeight = 44;
      const startY = 86;

      // Box 1: Total Dealers
      doc.rect(40, startY, boxWidth, boxHeight)
         .fillColor("#f8fafc")
         .fill()
         .strokeColor(borderColor)
         .lineWidth(0.5)
         .stroke();
      doc.fillColor(secondaryColor).font("Helvetica-Bold").fontSize(7).text("ASSIGNED DEALERS", 48, startY + 8);
      doc.fillColor(textColor).fontSize(13).text(uniqueDealersCount.toString(), 48, startY + 22);

      // Box 2: Total Invoices
      doc.rect(215, startY, boxWidth, boxHeight)
         .fillColor("#f8fafc")
         .fill()
         .strokeColor(borderColor)
         .lineWidth(0.5)
         .stroke();
      doc.fillColor(secondaryColor).font("Helvetica-Bold").fontSize(7).text("TOTAL PENDING INVOICES", 223, startY + 8);
      doc.fillColor(textColor).fontSize(13).text(totalInvoicesCount.toString(), 223, startY + 22);

      // Box 3: Total Outstanding
      doc.rect(390, startY, boxWidth, boxHeight)
         .fillColor("#f8fafc")
         .fill()
         .strokeColor(borderColor)
         .lineWidth(0.5)
         .stroke();
      doc.fillColor(secondaryColor).font("Helvetica-Bold").fontSize(7).text("TOTAL OUTSTANDING BALANCE", 398, startY + 8);
      doc.fillColor(primaryColor).fontSize(13).text(formatCurrencyForPdf(totalOutstanding, currency), 398, startY + 22);

      // 3. Dealer Aging Bucket Definitions (5 stages based on oldest invoice)
      const bucketDefs = [
        { label: "120+ DAYS",   title: "MORE THAN 120 DAYS OVERDUE", min: 121, max: Infinity, color: warningRed,   bg: "#fef2f2", bannerBg: "#991b1b" },
        { label: "90-120 DAYS", title: "90 TO 120 DAYS OVERDUE",     min: 91,  max: 120,      color: warningAmber, bg: "#fffbeb", bannerBg: "#b45309" },
        { label: "60-90 DAYS",  title: "60 TO 90 DAYS DUE",          min: 61,  max: 90,       color: "#334155",    bg: "#f8fafc", bannerBg: "#334155" },
        { label: "30-60 DAYS",  title: "30 TO 60 DAYS DUE",          min: 31,  max: 60,       color: "#2563eb",    bg: "#eff6ff", bannerBg: "#1d4ed8" },
        { label: "0-30 DAYS",   title: "0 TO 30 DAYS DUE",           min: 0,   max: 30,       color: cdGreen,      bg: "#f0fdf4", bannerBg: "#15803d" },
      ];

      function getStageIndex(age: number) {
        if (age > 120) return 0;
        if (age > 90)  return 1;
        if (age > 60)  return 2;
        if (age > 30)  return 3;
        return 4;
      }

      // Group each unique dealer and classify strictly by their oldest invoice (max bill age)
      interface DealerInfo {
        name: string;
        code: string;
        headerLabel: string;
        invoices: DueRecord[];
        totalOutstanding: number;
        oldestAge: number;
        stageIndex: number;
      }

      const dealerGroups: DealerInfo[] = [];

      for (const [dealerName, dealerInvoices] of dealerMap.entries()) {
        const dealerCode = dealerInvoices[0]?.dealerCode || dealerInvoices[0]?.customerCode || "";
        const dealerHeaderLabel = dealerCode ? `${dealerName} (${dealerCode})` : dealerName;
        const totalOutstanding = dealerInvoices.reduce((sum, d) => sum + (d.amount || 0), 0);
        const ages = dealerInvoices.map((d) => getBillAgeDays(d.billDate || d.invoiceDate, today) || 0);
        const oldestAge = Math.max(0, ...ages);
        const stageIndex = getStageIndex(oldestAge);

        dealerGroups.push({
          name: dealerName,
          code: dealerCode,
          headerLabel: dealerHeaderLabel,
          invoices: dealerInvoices,
          totalOutstanding,
          oldestAge,
          stageIndex
        });
      }

      // Calculate stats for 5 mini cards: each summary box calculates ONLY invoice amounts within that age bracket
      const bucketStats = bucketDefs.map((b, stageIdx) => {
        const matchingInvoices = dues.filter((d) => {
          const age = getBillAgeDays(d.billDate || d.invoiceDate, today) || 0;
          return age >= b.min && age <= b.max;
        });
        const amount = matchingInvoices.reduce((sum, d) => sum + (d.amount || 0), 0);
        const dealerKeys = new Set(
          matchingInvoices.map((d) => (d.companyName || d.dealerCode || "Unknown Dealer").trim())
        );
        const dealerCount = dealerKeys.size;
        const stageDealers = dealerGroups.filter((g) => g.stageIndex === stageIdx);

        return {
          ...b,
          dealerCount,
          amount,
          dealers: stageDealers
        };
      });

      const agingY = startY + boxHeight + 8;
      const miniWidth = 97;
      const miniHeight = 50;
      const cardGap = 7.5;

      bucketStats.forEach((box, idx) => {
        const cardX = 40 + idx * (miniWidth + cardGap);

        doc.rect(cardX, agingY, miniWidth, miniHeight)
           .fillColor("#f8fafc")
           .fill()
           .strokeColor(borderColor)
           .lineWidth(0.5)
           .stroke();

        // Bracket label
        doc.fillColor(secondaryColor).font("Helvetica-Bold").fontSize(7)
           .text(box.label, cardX + 4, agingY + 7, { width: miniWidth - 8, align: "center" });

        // Dealers count and Total Outstanding amount are EQUAL in size (8.5pt bold)
        doc.fillColor(box.color).font("Helvetica-Bold").fontSize(8.5)
           .text(`${box.dealerCount} Dealers`, cardX + 4, agingY + 20, { width: miniWidth - 8, align: "center" });
        doc.fillColor(textColor).font("Helvetica-Bold").fontSize(8.5)
           .text(formatCurrencyForPdf(box.amount, currency), cardX + 4, agingY + 34, { width: miniWidth - 8, align: "center" });
      });

      let currentY = agingY + miniHeight + 14;

      // Columns: # | Invoice No. | Bill Date | Due Date | Bill Age | Outstanding (Minimal light gray theme, normal text)
      function renderTableHeader(yPos: number) {
        doc.rect(40, yPos, 515, 17)
           .fillColor("#f8fafc")
           .fill()
           .strokeColor("#e2e8f0")
           .lineWidth(0.5)
           .stroke();

        doc.fillColor("#64748b")
           .font("Helvetica")
           .fontSize(7.5);

        doc.text("#",            46,  yPos + 4.5, { width: 18 });
        doc.text("Invoice No.",  68,  yPos + 4.5, { width: 105 });
        doc.text("Bill Date",    178, yPos + 4.5, { width: 80 });
        doc.text("Due Date",     262, yPos + 4.5, { width: 80 });
        doc.text("Bill Age",     346, yPos + 4.5, { width: 72, align: "center" });
        doc.text("Outstanding",  422, yPos + 4.5, { width: 125, align: "right" });

        return yPos + 17;
      }

      // 4. Render Dealers Grouped by Stage Headings
      let globalDealerIndex = 0;

      bucketStats.forEach((stageBucket, stageIdx) => {
        // Skip stage section if no dealers have their oldest invoice in this stage
        if (stageBucket.dealers.length === 0) return;

        // Check space for Stage Header
        if (currentY > 680) {
          doc.addPage();
          currentY = 40;
        }

        // Stage Section Banner (PRIOR AGE BRACKET HEADING)
        doc.rect(40, currentY, 515, 20)
           .fillColor(stageBucket.bannerBg)
           .fill();

        doc.fillColor("#ffffff")
           .font("Helvetica-Bold")
           .fontSize(9)
           .text(
             `STAGE ${stageIdx + 1}: ${stageBucket.title}   (${stageBucket.dealers.length} Dealers   |   Total: ${formatCurrencyForPdf(stageBucket.amount, currency)})`,
             48,
             currentY + 5.5,
             { width: 500 }
           );

        currentY += 24;

        // Sort dealers within this stage by oldest invoice descending
        const sortedStageDealers = [...stageBucket.dealers].sort((a, b) => b.oldestAge - a.oldestAge || b.totalOutstanding - a.totalOutstanding);

        sortedStageDealers.forEach((dealer) => {
          globalDealerIndex++;

          // Check if room for dealer banner + table header + at least 1 row
          if (currentY > 690) {
            doc.addPage();
            currentY = 40;
          }

          // Dealer Banner - Light Gray Theme with Highlighted Dealer Name (PRIOR)
          doc.rect(40, currentY, 515, 18)
             .fillColor("#f1f5f9")
             .fill()
             .strokeColor("#cbd5e1")
             .lineWidth(0.5)
             .stroke();

          // Left accent stripe matching stage color
          doc.rect(40, currentY, 3, 18)
             .fillColor(stageBucket.bannerBg)
             .fill();

          // HIGHLIGHT DEALER NAME (PRIOR)
          doc.fillColor("#0f172a")
             .font("Helvetica-Bold")
             .fontSize(8.5)
             .text(
               `Dealer ${globalDealerIndex}: ${dealer.headerLabel}  [Oldest Invoice: ${dealer.oldestAge} Days]`,
               48,
               currentY + 5,
               { width: 310, height: 11, ellipsis: true }
             );

          // Normal secondary text for invoices & total
          doc.font("Helvetica")
             .fontSize(7.5)
             .fillColor("#64748b")
             .text(`${dealer.invoices.length} Invoices  |  Total: `, 360, currentY + 5, { width: 100, align: "right" });

          // Dealer Total Outstanding (SECONDARY PRIOR)
          doc.font("Helvetica-Bold")
             .fontSize(8)
             .fillColor("#0f172a")
             .text(formatCurrencyForPdf(dealer.totalOutstanding, currency), 460, currentY + 5, { width: 90, align: "right" });

          currentY += 18;
          currentY = renderTableHeader(currentY);

          // Sort dealer's invoices: oldest bill age first
          const sortedInvoices = [...dealer.invoices].sort((a, b) => {
            const ageA = getBillAgeDays(a.billDate || a.invoiceDate, today) || 0;
            const ageB = getBillAgeDays(b.billDate || b.invoiceDate, today) || 0;
            return ageB - ageA;
          });

          sortedInvoices.forEach((due, invIdx) => {
            const billAge = getBillAgeDays(due.billDate || due.invoiceDate, today);

            if (currentY > 730) {
              doc.addPage();
              currentY = 40;
              // Redraw Dealer header reminder on new page
              doc.rect(40, currentY, 515, 16)
                 .fillColor("#f1f5f9")
                 .fill()
                 .strokeColor("#e2e8f0")
                 .lineWidth(0.5)
                 .stroke();
              doc.fillColor("#0f172a")
                 .font("Helvetica-Bold")
                 .fontSize(7.5)
                 .text(`(Continued) Dealer: ${dealer.headerLabel}`, 48, currentY + 4, { width: 500 });
              currentY += 16;
              currentY = renderTableHeader(currentY);
            }

            const ageText = billAge !== null ? `${billAge} Days` : "-";
            const isZebra = invIdx % 2 === 1;
            const rowBg = isZebra ? "#fcfcfc" : "#ffffff";

            doc.rect(40, currentY, 515, 17)
               .fillColor(rowBg)
               .fill();

            const invNo = due.invoiceNumber || due.reference || "-";
            const bDate = due.billDate || due.invoiceDate ? formatDate(due.billDate || due.invoiceDate) : "-";
            const dDate = due.dueDate ? formatDate(due.dueDate) : "-";

            // # (normal light gray text)
            doc.fillColor("#94a3b8")
               .font("Helvetica")
               .fontSize(7.5)
               .text((invIdx + 1).toString(), 46, currentY + 4, { width: 18 });

            // Invoice No (normal simple text, NOT bold)
            doc.fillColor("#475569")
               .font("Helvetica")
               .fontSize(7.5)
               .text(invNo, 68, currentY + 4, { width: 105, height: 10, ellipsis: true });

            // Bill Date & Due Date (normal simple text, NOT bold)
            doc.fillColor("#64748b")
               .font("Helvetica")
               .fontSize(7.5)
               .text(bDate, 178, currentY + 4, { width: 80 })
               .text(dDate, 262, currentY + 4, { width: 80 });

            // HIGHLIGHT BILL AGE (PRIOR!)
            const ageColor = billAge !== null && billAge > 120 
              ? warningRed 
              : (billAge !== null && billAge > 90 
                ? warningAmber 
                : (billAge !== null && billAge > 60 
                  ? "#d97706" 
                  : textColor));

            doc.font("Helvetica-Bold")
               .fontSize(8.5)
               .fillColor(ageColor)
               .text(ageText, 346, currentY + 3.5, { width: 72, align: "center" });

            // Outstanding Amount (SECONDARY PRIOR)
            doc.font("Helvetica-Bold")
               .fontSize(7.5)
               .fillColor("#0f172a")
               .text(formatCurrencyForPdf(due.amount, currency), 422, currentY + 4, { width: 125, align: "right" });

            currentY += 17;

            doc.strokeColor("#f1f5f9")
               .lineWidth(0.5)
               .moveTo(40, currentY)
               .lineTo(555, currentY)
               .stroke();
          });

          // Spacing after each dealer table
          currentY += 10;
        });

        // Spacing after each stage section
        currentY += 6;
      });

      // Report Footer
      if (currentY > 730) {
        doc.addPage();
        currentY = 40;
      }

      doc.strokeColor(borderColor)
         .lineWidth(0.5)
         .moveTo(40, currentY + 8)
         .lineTo(555, currentY + 8)
         .stroke();

      doc.fontSize(7.5)
         .font("Helvetica")
         .fillColor(secondaryColor)
         .text(
           "This is an automated Manager Outstanding & Aging Portfolio statement generated by ARB Auto Payment Reminder System.",
           40,
           currentY + 16,
           { align: "center", width: 515 }
         );

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
