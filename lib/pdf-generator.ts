import PDFDocument from "pdfkit";
import { formatCurrency, formatDate, getBillAgeDays } from "@/lib/utils";
import type { DueRecord } from "@/lib/types";

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
         .text(`Company Name : ${customerName}`, 50, 130)
         .text(`Dealer Code  : ${dealerCode}`, 50, 145);

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

      const sortedTriggerDays: number[] = activeTriggerDays.length > 0 ? activeTriggerDays : [30, 45, 60, 75, 80, 85, 90];

      // Find current rule trigger day
      const currentRule = rules?.find((r: any) => r.id === ruleId);
      const matchedDue = currentDueId ? dues.find(d => d.id === currentDueId) : dues[0];
      // Engine fires 5 days before nominal day: nominal rule day = billAge + 5
      const rawBillAge = matchedDue ? (getBillAgeDays(matchedDue.billDate || matchedDue.invoiceDate, new Date()) || 0) : 0;
      const defaultDay = rawBillAge > 0 ? rawBillAge + 5 : 30;
      const currentRuleDay = currentRule ? currentRule.triggerDay : defaultDay;

      const currentIdx = sortedTriggerDays.indexOf(currentRuleDay);
      const nextRuleDay = (currentIdx !== -1 && currentIdx < sortedTriggerDays.length - 1)
        ? sortedTriggerDays[currentIdx + 1]
        : 120; // default/fallback

      const today = new Date();
      const getAmountForTriggerDay = (day: number) => {
        const idx = sortedTriggerDays.indexOf(day);
        if (idx === -1) {
          return day === currentRuleDay && matchedDue ? matchedDue.amount : 0;
        }
        const minAge = idx === 0 ? -Infinity : sortedTriggerDays[idx - 1] + 1;
        const maxAge = idx === sortedTriggerDays.length - 1 ? Infinity : day;

        return dues
          .filter((entry) => {
            const age = getBillAgeDays(entry.billDate || entry.invoiceDate, today) || 0;
            const nominalAge = age + 5; // engine offset: rule triggers 5 days before nominal day
            return nominalAge >= minAge && nominalAge <= maxAge;
          })
          .reduce((sum, entry) => sum + (entry.amount || 0), 0);
      };

      const box2Amount = getAmountForTriggerDay(currentRuleDay);
      const box3Amount = getAmountForTriggerDay(nextRuleDay);

      const isBox2Cd = currentRuleDay <= 60;
      const box2Label = `PAYMENT DUE IN ${currentRuleDay} DAYS${isBox2Cd ? " (for CD)" : ""}`;

      const isBox3Cd = nextRuleDay <= 60;
      const box3Label = nextRuleDay > 90
        ? `PAYMENT DUE IN 90+ DAYS`
        : `PAYMENT DUE IN ${nextRuleDay} DAYS${isBox3Cd ? " (for CD)" : ""}`;

      const calculatedTotalOutstanding = box2Amount + box3Amount;

      const boxWidth = 155;
      const boxHeight = 50;
      const boxY = 165;

      // Box 1: Payment Due in X Days
      doc.rect(50, boxY, boxWidth, boxHeight)
         .fillColor("#fafafa")
         .fill()
         .strokeColor(borderColor)
         .lineWidth(1)
         .stroke();
      doc.fillColor(primaryColor)
         .font("Helvetica-Bold")
         .fontSize(6.5)
         .text(box2Label.toUpperCase(), 58, boxY + 12, { width: 140 });
      doc.fontSize(11)
         .fillColor(textColor)
         .text(formatCurrencyForPdf(box2Amount, currency), 58, boxY + 26, { width: 140 });

      // Box 2: Payment Due in Y Days
      doc.rect(220, boxY, boxWidth, boxHeight)
         .fillColor("#fafafa")
         .fill()
         .strokeColor(borderColor)
         .lineWidth(1)
         .stroke();
      doc.fillColor(primaryColor)
         .font("Helvetica-Bold")
         .fontSize(6.5)
         .text(box3Label.toUpperCase(), 228, boxY + 12, { width: 140 });
      doc.fontSize(11)
         .fillColor("#b45309") // Amber/orange
         .text(formatCurrencyForPdf(box3Amount, currency), 228, boxY + 26, { width: 140 });

      // Box 3: Total Outstanding
      doc.rect(390, boxY, boxWidth, boxHeight)
         .fillColor("#fafafa")
         .fill()
         .strokeColor(borderColor)
         .lineWidth(1)
         .stroke();
      doc.fillColor(primaryColor)
         .font("Helvetica-Bold")
         .fontSize(6.5)
         .text("TOTAL OUTSTANDING", 398, boxY + 12, { width: 140 });
      doc.fontSize(11)
         .fillColor("#0f766e") // Teal
         .text(formatCurrencyForPdf(calculatedTotalOutstanding, currency), 398, boxY + 26, { width: 140 });

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
