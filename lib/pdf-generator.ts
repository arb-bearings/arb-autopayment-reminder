import PDFDocument from "pdfkit";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { DueRecord } from "@/lib/types";

/**
 * Generates an A4 PDF invoice statement from a list of due records and returns it as a Buffer.
 */
export function generateOutstandingPDF(
  customerName: string,
  dealerCode: string,
  dues: DueRecord[],
  totalAmount: number,
  currency: string
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50, size: "A4" });
      const chunks: Buffer[] = [];

      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", (err) => reject(err));

      // Design System Colors
      const primaryColor = "#1e293b"; // Sleek dark slate
      const secondaryColor = "#64748b"; // Medium slate grey
      const textColor = "#0f172a"; // Almost black
      const borderColor = "#cbd5e1"; // Light grey
      const warningRed = "#b91c1c"; // Clean warning red

      // 1. Document Header
      doc.fillColor(primaryColor)
         .fontSize(22)
         .font("Helvetica-Bold")
         .text("OUTSTANDING STATEMENT", 50, 50);

      doc.fontSize(10)
         .font("Helvetica")
         .fillColor(secondaryColor)
         .text(`Generated on: ${new Intl.DateTimeFormat("en-IN", { dateStyle: "long", timeStyle: "short" }).format(new Date())}`, 50, 75);

      // Horizontal separator line
      doc.strokeColor(borderColor)
         .lineWidth(1)
         .moveTo(50, 95)
         .lineTo(545, 95)
         .stroke();

      // 2. Customer Info & Summary Panel
      doc.fillColor(primaryColor)
         .fontSize(11)
         .font("Helvetica-Bold")
         .text("CUSTOMER DETAILS", 50, 115);

      doc.font("Helvetica")
         .fontSize(10)
         .fillColor(textColor)
         .text(`Company Name : ${customerName}`, 50, 132)
         .text(`Dealer Code  : ${dealerCode}`, 50, 147);

      // Summary Box
      doc.rect(345, 115, 200, 50)
         .fillColor("#f8fafc")
         .fill()
         .strokeColor(borderColor)
         .stroke();

      doc.fillColor(primaryColor)
         .font("Helvetica-Bold")
         .fontSize(9)
         .text("TOTAL OUTSTANDING DUE", 360, 123);

      doc.fontSize(13)
         .fillColor(warningRed)
         .text(formatCurrency(totalAmount, currency), 360, 137);

      // 3. Table Header
      const tableTop = 195;
      doc.strokeColor(borderColor)
         .lineWidth(1)
         .moveTo(50, tableTop)
         .lineTo(545, tableTop)
         .stroke();

      // Table Header row bg
      doc.rect(50, tableTop, 495, 20)
         .fillColor("#f1f5f9")
         .fill();

      doc.fillColor(primaryColor)
         .font("Helvetica-Bold")
         .fontSize(9);

      // Column headers
      doc.text("Invoice #", 60, tableTop + 6, { width: 100 });
      doc.text("Bill Date", 160, tableTop + 6, { width: 80 });
      doc.text("Due Date", 250, tableTop + 6, { width: 80 });
      doc.text("Overdue", 340, tableTop + 6, { width: 60, align: "center" });
      doc.text("Amount", 440, tableTop + 6, { width: 95, align: "right" });

      doc.strokeColor(borderColor)
         .lineWidth(1)
         .moveTo(50, tableTop + 20)
         .lineTo(545, tableTop + 20)
         .stroke();

      // 4. Table Rows
      let currentY = tableTop + 20;
      doc.font("Helvetica").fontSize(9).fillColor("#334155");

      dues.forEach((due, index) => {
        // Alternating row background
        if (index % 2 === 1) {
          doc.rect(50, currentY, 495, 20)
             .fillColor("#f8fafc")
             .fill();
        }

        doc.fillColor(textColor)
           .text(due.invoiceNumber || due.reference || "-", 60, currentY + 6, { width: 100 })
           .text(due.billDate ? formatDate(due.billDate) : "-", 160, currentY + 6, { width: 80 })
           .text(due.dueDate ? formatDate(due.dueDate) : "-", 250, currentY + 6, { width: 80 })
           .text(due.overdueDays > 0 ? `${due.overdueDays} days` : "0 days", 340, currentY + 6, { width: 60, align: "center" })
           .text(formatCurrency(due.amount, due.currency), 440, currentY + 6, { width: 95, align: "right" });

        currentY += 20;

        // Draw thin horizontal row line
        doc.strokeColor("#e2e8f0")
           .lineWidth(0.5)
           .moveTo(50, currentY)
           .lineTo(545, currentY)
           .stroke();
      });

      // 5. Total Row
      doc.rect(50, currentY, 495, 22)
         .fillColor("#f1f5f9")
         .fill();

      doc.fillColor(primaryColor)
         .font("Helvetica-Bold")
         .text("Total Outstanding", 60, currentY + 6)
         .text(formatCurrency(totalAmount, currency), 440, currentY + 6, { width: 95, align: "right" });

      doc.strokeColor(borderColor)
         .lineWidth(1)
         .moveTo(50, currentY + 22)
         .lineTo(545, currentY + 22)
         .stroke();

      // Footer
      const footerY = 750;
      doc.strokeColor(borderColor)
         .lineWidth(0.5)
         .moveTo(50, footerY)
         .lineTo(545, footerY)
         .stroke();

      doc.fontSize(8)
         .font("Helvetica")
         .fillColor(secondaryColor)
         .text("This is an automatically generated document. Thank you for your cooperation.", 50, footerY + 10, { align: "center" });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
