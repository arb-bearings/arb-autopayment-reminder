import { NextRequest, NextResponse } from "next/server";
import { readDatabase } from "@/lib/storage";
import { getDuePartyKey } from "@/lib/utils";
import { generateOutstandingPDF } from "@/lib/pdf-generator";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const logId = searchParams.get("logId");

  if (!logId) {
    return new NextResponse("Missing logId parameter", { status: 400 });
  }

  try {
    const db = await readDatabase();
    const log = db.reminderLogs.find((entry) => entry.id === logId);

    if (!log) {
      return new NextResponse("Reminder log not found", { status: 404 });
    }

    // Find the due record associated with the log
    const due = db.dueRecords.find((entry) => entry.id === log.dueId);
    if (!due) {
      return new NextResponse("Associated due record not found", { status: 404 });
    }

    // Find all outstanding dues for this dealer code/party
    const allDuesForDealer = db.dueRecords.filter(
      (entry) => getDuePartyKey(entry) === getDuePartyKey(due)
    );

    const totalAmount = allDuesForDealer.reduce((sum, item) => sum + (item.amount || 0), 0);
    const currency = due.currency || "INR";
    const customerName = due.matchedContactName || due.companyName || log.dealerCode || "Customer";
    const dealerCode = due.dealerCode || due.customerCode || log.dealerCode || "-";

    const pdfBuffer = await generateOutstandingPDF(
      customerName,
      dealerCode,
      allDuesForDealer,
      totalAmount,
      currency
    );

    return new Response(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="invoice-status-${dealerCode}.pdf"`
      }
    });
  } catch (error) {
    console.error("Failed to generate PDF statement:", error);
    return new NextResponse(
      `Failed to generate statement PDF: ${error instanceof Error ? error.message : "Unknown error"}`,
      { status: 500 }
    );
  }
}
