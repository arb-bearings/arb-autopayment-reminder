import * as XLSX from "xlsx";

type SampleWorkbookKind = "master" | "due" | "salesperson";

type SampleWorkbookConfig = {
  fileName: string;
  sheetName: string;
  rows: Array<Record<string, string | number>>;
};

const sampleWorkbooks: Record<SampleWorkbookKind, SampleWorkbookConfig> = {
  master: {
    fileName: "sample-master-database.xlsx",
    sheetName: "Master Database",
    rows: [
      {
        "Dealer Code": "DLR-001",
        "Company Name": "Example Trading Co.",
        "Contact Person": "Ravi Sharma",
        Email: "accounts@exampletrading.com",
        WhatsApp: "919876543210",
        Phone: "919876543210"
      }
    ]
  },
  due: {
    fileName: "sample-due-database.xlsx",
    sheetName: "Due Database",
    get rows() {
      const getOffsetDate = (daysAgo: number) => {
        const d = new Date();
        d.setDate(d.getDate() - daysAgo);
        return d.toISOString().split("T")[0];
      };

      const getOffsetDueDate = (daysAgo: number, creditTerm: number) => {
        const d = new Date();
        d.setDate(d.getDate() - daysAgo + creditTerm);
        return d.toISOString().split("T")[0];
      };

      return [
        // ─── Dealer 1: Orion Wholesale (30-day CD eligible + future due) ───
        {
          "Ref. No.": "OR-3001",
          "opening": 22000,
          "pending": 18450,
          "overdue": 0,
          "Date": getOffsetDate(25), // 25 days old -> triggers 30-day reminder (due in 5 days)
          "Party's Name": "Orion Wholesale Private Limited",
          "Due on": getOffsetDueDate(25, 30),
          "Dealer Code": "TST001",
          "Currency": "INR"
        },
        {
          "Ref. No.": "OR-3002",
          "opening": 15000,
          "pending": 15000,
          "overdue": 0,
          "Date": getOffsetDate(5), // Future due invoice (5 days old)
          "Party's Name": "Orion Wholesale Private Limited",
          "Due on": getOffsetDueDate(5, 30),
          "Dealer Code": "TST001",
          "Currency": "INR"
        },
        // ─── Dealer 2: Nimbus Surgical (45-day CD eligible) ─────────────────
        {
          "Ref. No.": "NB-4502",
          "opening": 31500,
          "pending": 31500,
          "overdue": 0,
          "Date": getOffsetDate(40), // 40 days old -> triggers 45-day reminder (due in 5 days)
          "Party's Name": "Nimbus Surgical Agencies",
          "Due on": getOffsetDueDate(40, 45),
          "Dealer Code": "TST002",
          "Currency": "INR"
        },
        // ─── Dealer 3: Cedar Retail (60-day reminder, not CD eligible) ───────
        {
          "Ref. No.": "CD-9003",
          "opening": 48720,
          "pending": 40200,
          "overdue": 0,
          "Date": getOffsetDate(55), // 55 days old -> triggers 60-day reminder (due in 5 days)
          "Party's Name": "Cedar Retail Mart",
          "Due on": getOffsetDueDate(55, 60),
          "Dealer Code": "TST003",
          "Currency": "INR"
        },
        // ─── Dealer 4: Apex Medico (75-day reminder + previous outstanding) ──
        // This dealer is NOT eligible for cash discounts because an older unpaid invoice exists (AP-4503).
        {
          "Ref. No.": "AP-4504",
          "opening": 70500,
          "pending": 67500,
          "overdue": 0,
          "Date": getOffsetDate(70), // 70 days old -> triggers 75-day reminder
          "Party's Name": "Apex Medico Distributors",
          "Due on": getOffsetDueDate(70, 75),
          "Dealer Code": "TST004",
          "Currency": "INR"
        },
        {
          "Ref. No.": "AP-4503",
          "opening": 25000,
          "pending": 25000,
          "overdue": 5,
          "Date": getOffsetDate(80), // Older invoice (80 days old)
          "Party's Name": "Apex Medico Distributors",
          "Due on": getOffsetDueDate(80, 75),
          "Dealer Code": "TST004",
          "Currency": "INR"
        },
        // ─── Dealer 5: Zenith Pharma (80-day reminder) ──────────────────────
        {
          "Ref. No.": "ZN-8005",
          "opening": 55000,
          "pending": 55000,
          "overdue": 0,
          "Date": getOffsetDate(75), // 75 days old -> triggers 80-day reminder
          "Party's Name": "Zenith Pharma Labs",
          "Due on": getOffsetDueDate(75, 80),
          "Dealer Code": "TST005",
          "Currency": "INR"
        },
        // ─── Dealer 6: Matrix Health (85-day reminder) ──────────────────────
        {
          "Ref. No.": "MX-8506",
          "opening": 60000,
          "pending": 60000,
          "overdue": 0,
          "Date": getOffsetDate(80), // 80 days old -> triggers 85-day reminder
          "Party's Name": "Matrix Health Link",
          "Due on": getOffsetDueDate(80, 85),
          "Dealer Code": "TST006",
          "Currency": "INR"
        },
        // ─── Dealer 7: Nova Care (90-day critical reminder) ─────────────────
        {
          "Ref. No.": "NV-9007",
          "opening": 85000,
          "pending": 85000,
          "overdue": 0,
          "Date": getOffsetDate(85), // 85 days old -> triggers 90-day reminder
          "Party's Name": "Nova Care Enterprises",
          "Due on": getOffsetDueDate(85, 90),
          "Dealer Code": "TST007",
          "Currency": "INR"
        }
      ];
    }
  },
  salesperson: {
    fileName: "sample-salesperson-mapping.xlsx",
    sheetName: "Salespersons",
    rows: [
      {
        "Salesperson Name": "Aman Kumar",
        "Employee ID": "SP-001",
        Email: "aman@example.com",
        "Phone Number": "919876543210",
        "Dealer Codes": "DLR-001, DLR-002"
      }
    ]
  }
};

function buildWorkbook(rows: SampleWorkbookConfig["rows"], sheetName: string) {
  const worksheet = XLSX.utils.json_to_sheet(rows);
  worksheet["!cols"] = Object.keys(rows[0] || {}).map((header) => ({
    wch: Math.max(header.length + 2, 18)
  }));

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  return workbook;
}

export function buildSampleWorkbookResponse(kind: SampleWorkbookKind) {
  const config = sampleWorkbooks[kind];
  const workbook = buildWorkbook(config.rows, config.sheetName);
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${config.fileName}"`
    }
  });
}
