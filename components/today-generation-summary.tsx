"use client";

import { useMemo, useState, useEffect } from "react";
import type { DueRecord, MasterContact, ReminderLog } from "@/lib/types";
import { findMatchingMasterContact } from "@/lib/contact-matching";
import { formatCurrency, formatDate, extractDealerCodeAndName } from "@/lib/utils";
import { ChannelLabel } from "./channel-label";
import Link from "next/link";

interface TodayGenerationSummaryProps {
  todayGeneratedLogs: ReminderLog[];
  masterContacts: MasterContact[];
  dueRecords: DueRecord[];
  isAdmin: boolean;
}

export function TodayGenerationSummary({
  todayGeneratedLogs,
  masterContacts,
  dueRecords,
  isAdmin
}: TodayGenerationSummaryProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"all" | "matched" | "missing" | "pending" | "sent" | "failed">("all");

  // Close modal on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  const masterContactMap = useMemo(() => {
    return new Map(masterContacts.map((c) => [c.id, c]));
  }, [masterContacts]);

  // Enrich each log with contact matching information
  const enrichedLogs = useMemo(() => {
    return todayGeneratedLogs.map((log) => {
      const extracted = extractDealerCodeAndName(log.dealerCode || "", log.dealerName || "");
      const cleanDealerCode = extracted.dealerCode || log.dealerCode || "";
      const cleanDealerName = extracted.companyName || log.dealerName || "";

      let matchingContact = log.contactId ? masterContactMap.get(log.contactId) : null;
      if (!matchingContact) {
        matchingContact = findMatchingMasterContact(
          {
            dealerCode: cleanDealerCode,
            customerCode: cleanDealerCode,
            companyName: cleanDealerName,
            matchedContactId: "",
            matchedContactName: "",
            matchedEmail: "",
            matchedWhatsapp: "",
            matchedSms: "",
            contactMatchStatus: "missing"
          },
          masterContacts
        );
      }

      const finalDealerCode = cleanDealerCode || matchingContact?.dealerCode || "";
      const finalDealerName = cleanDealerName || matchingContact?.companyName || "Unknown Dealer";

      const hasMissingReason =
        Boolean(log.failureReason && /contact|master/i.test(log.failureReason)) ||
        log.recipient.toLowerCase().includes("no master contact") ||
        log.recipient.toLowerCase().includes("missing");

      const isMatched = Boolean(matchingContact) && !hasMissingReason && Boolean(log.recipient) && !log.recipient.toLowerCase().includes("no contact");

      let contactName = matchingContact?.primaryContact || finalDealerName || "Accounts Team";
      if (contactName === "Accounts Team" && matchingContact?.companyName) {
        contactName = matchingContact.primaryContact || matchingContact.companyName;
      }

      let matchReason = "";
      if (!isMatched) {
        if (!matchingContact) {
          matchReason = "No matching master contact in database";
        } else if (!log.recipient || log.recipient.toLowerCase().includes("missing")) {
          matchReason = `Missing ${log.channel} address in master contact`;
        } else {
          matchReason = log.failureReason || "Contact details incomplete";
        }
      }

      return {
        ...log,
        dealerCode: finalDealerCode,
        dealerName: finalDealerName,
        matchingContact,
        isMatched,
        contactName,
        matchReason
      };
    });
  }, [todayGeneratedLogs, masterContactMap, masterContacts]);

  // Calculate statistics
  const stats = useMemo(() => {
    const total = enrichedLogs.length;
    const matched = enrichedLogs.filter((l) => l.isMatched).length;
    const missing = total - matched;
    const pending = enrichedLogs.filter((l) => l.status === "pending").length;
    const sent = enrichedLogs.filter((l) => l.status === "sent").length;
    const failed = enrichedLogs.filter((l) => l.status === "failed").length;
    const totalAmount = enrichedLogs.reduce((sum, l) => sum + (l.relevantAmount || l.totalOutstanding || 0), 0);

    return {
      total,
      matched,
      missing,
      pending,
      sent,
      failed,
      totalAmount
    };
  }, [enrichedLogs]);

  // Filter logs based on search query and active tab
  const filteredLogs = useMemo(() => {
    let result = enrichedLogs;

    // Filter by tab
    if (activeTab === "matched") {
      result = result.filter((l) => l.isMatched);
    } else if (activeTab === "missing") {
      result = result.filter((l) => !l.isMatched);
    } else if (activeTab === "pending") {
      result = result.filter((l) => l.status === "pending");
    } else if (activeTab === "sent") {
      result = result.filter((l) => l.status === "sent");
    } else if (activeTab === "failed") {
      result = result.filter((l) => l.status === "failed");
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(
        (l) =>
          (l.dealerName || "").toLowerCase().includes(q) ||
          (l.dealerCode || "").toLowerCase().includes(q) ||
          (l.invoiceNumber || "").toLowerCase().includes(q) ||
          (l.recipient || "").toLowerCase().includes(q) ||
          (l.contactName || "").toLowerCase().includes(q) ||
          (l.selectedAgeingStage || "").toLowerCase().includes(q) ||
          (l.reminderType || "").toLowerCase().includes(q) ||
          (l.matchReason || "").toLowerCase().includes(q)
      );
    }

    return result;
  }, [enrichedLogs, activeTab, searchQuery]);

  // Export to CSV
  const handleExportCsv = () => {
    if (enrichedLogs.length === 0) return;

    const headers = [
      "No.",
      "Dealer Name",
      "Dealer Code",
      "Invoice Number(s)",
      "Ageing Stage",
      "Contact Person",
      "Contact Match Status",
      "Channel",
      "Recipient",
      "Relevant Amount",
      "Total Outstanding",
      "Queue Status",
      "Failure / Note"
    ];

    const rows = enrichedLogs.map((l, idx) => [
      idx + 1,
      `"${(l.dealerName || "").replace(/"/g, '""')}"`,
      `"${(l.dealerCode || "").replace(/"/g, '""')}"`,
      `"${(l.invoiceNumber || "").replace(/"/g, '""')}"`,
      `"${(l.selectedAgeingStage || l.reminderType || "").replace(/"/g, '""')}"`,
      `"${(l.contactName || "").replace(/"/g, '""')}"`,
      l.isMatched ? "Matched" : "Missing / Unmatched",
      l.channel,
      `"${(l.recipient || "").replace(/"/g, '""')}"`,
      l.relevantAmount || 0,
      l.totalOutstanding || 0,
      l.status,
      `"${(l.matchReason || l.failureReason || "").replace(/"/g, '""')}"`
    ]);

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `today-reminders-breakdown-${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <>
      {/* Summary Card Under the CTA */}
      <div className="generation-summary-widget">
        {stats.total === 0 ? (
          <div className="generation-widget-empty">
            <div className="generation-widget-icon">ℹ️</div>
            <div className="generation-widget-copy">
              <strong>No reminders generated for today yet.</strong>
              <p>Select a generation date and click &quot;Generate eligible reminders&quot; above to build the queue.</p>
            </div>
          </div>
        ) : (
          <div className="generation-widget-content" onClick={() => setIsOpen(true)}>
            <div className="generation-widget-header">
              <div className="generation-widget-title-wrap">
                <span className="generation-pulse-dot" />
                <span className="generation-widget-title">Today&apos;s Generated Reminders</span>
              </div>
              <button
                type="button"
                className="generation-view-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsOpen(true);
                }}
              >
                View Breakdown Table ↗
              </button>
            </div>

            <div className="generation-stats-pills">
              <div className="gen-pill total">
                <span className="gen-pill-label">Total Generated</span>
                <span className="gen-pill-value">{stats.total}</span>
              </div>
              <div className="gen-pill matched">
                <span className="gen-pill-label">🟢 Contacts Matched</span>
                <span className="gen-pill-value">{stats.matched}</span>
              </div>
              <div className={`gen-pill ${stats.missing > 0 ? "missing" : "neutral"}`}>
                <span className="gen-pill-label">{stats.missing > 0 ? "⚠️" : "⚪"} Contacts Missing</span>
                <span className="gen-pill-value">{stats.missing}</span>
              </div>
            </div>

            <p className="generation-widget-note">
              Click anywhere on this card to inspect the full list of today&apos;s invoices, dealer codes, and contact match status.
            </p>
          </div>
        )}
      </div>

      {/* Interactive Modal Dialog */}
      {isOpen && (
        <div className="generation-modal-overlay" onClick={() => setIsOpen(false)}>
          <div className="generation-modal-dialog" onClick={(e) => e.stopPropagation()}>
            {/* Modal Header */}
            <div className="generation-modal-header">
              <div>
                <div className="generation-modal-eyebrow">Today&apos;s Generation Queue</div>
                <h2 className="generation-modal-title">Generated Reminders & Contact Match List</h2>
                <p className="generation-modal-sub">
                  Showing all {stats.total} reminder records generated for today ({stats.matched} matched, {stats.missing} missing contact).
                </p>
              </div>
              <button
                type="button"
                className="generation-modal-close"
                onClick={() => setIsOpen(false)}
                aria-label="Close modal"
              >
                ✕
              </button>
            </div>

            {/* Modal Stats Bar */}
            <div className="generation-modal-kpis">
              <div className="gen-kpi-item">
                <span className="kpi-label">Total Reminders</span>
                <span className="kpi-val">{stats.total}</span>
              </div>
              <div className="gen-kpi-item">
                <span className="kpi-label">Matched Contacts</span>
                <span className="kpi-val text-success">{stats.matched}</span>
              </div>
              <div className="gen-kpi-item">
                <span className="kpi-label">Missing Contacts</span>
                <span className="kpi-val text-danger">{stats.missing}</span>
              </div>
              <div className="gen-kpi-item">
                <span className="kpi-label">Pending Queue</span>
                <span className="kpi-val">{stats.pending}</span>
              </div>
              <div className="gen-kpi-item">
                <span className="kpi-label">Total Amount</span>
                <span className="kpi-val">{formatCurrency(stats.totalAmount)}</span>
              </div>
            </div>

            {/* Modal Toolbar: Search, Filter Tabs & Export */}
            <div className="generation-modal-toolbar">
              <div className="generation-tabs">
                <button
                  type="button"
                  className={`gen-tab ${activeTab === "all" ? "active" : ""}`}
                  onClick={() => setActiveTab("all")}
                >
                  All ({stats.total})
                </button>
                <button
                  type="button"
                  className={`gen-tab matched ${activeTab === "matched" ? "active" : ""}`}
                  onClick={() => setActiveTab("matched")}
                >
                  🟢 Matched ({stats.matched})
                </button>
                <button
                  type="button"
                  className={`gen-tab missing ${activeTab === "missing" ? "active" : ""}`}
                  onClick={() => setActiveTab("missing")}
                >
                  🔴 Missing Contacts ({stats.missing})
                </button>
                <button
                  type="button"
                  className={`gen-tab ${activeTab === "pending" ? "active" : ""}`}
                  onClick={() => setActiveTab("pending")}
                >
                  Pending ({stats.pending})
                </button>
                {stats.sent > 0 && (
                  <button
                    type="button"
                    className={`gen-tab ${activeTab === "sent" ? "active" : ""}`}
                    onClick={() => setActiveTab("sent")}
                  >
                    Sent ({stats.sent})
                  </button>
                )}
                {stats.failed > 0 && (
                  <button
                    type="button"
                    className={`gen-tab ${activeTab === "failed" ? "active" : ""}`}
                    onClick={() => setActiveTab("failed")}
                  >
                    Failed ({stats.failed})
                  </button>
                )}
              </div>

              <div className="generation-actions-right">
                <div className="gen-search-wrap">
                  <input
                    type="search"
                    placeholder="Search dealer, code, invoice #, recipient..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="gen-search-input"
                  />
                </div>
                <button type="button" className="button button-secondary gen-export-btn" onClick={handleExportCsv}>
                  📥 Export CSV
                </button>
              </div>
            </div>

            {/* Modal Table */}
            <div className="generation-modal-table-wrap">
              <table className="generation-table">
                <thead>
                  <tr>
                    <th style={{ width: "45px" }}>#</th>
                    <th>Invoice No.</th>
                    <th>Dealer Name & Code</th>
                    <th>Ageing Stage</th>
                    <th>Contact Person</th>
                    <th>Contact Match Status</th>
                    <th>Channel & Recipient</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Failure / Note</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLogs.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="generation-empty-td">
                        No reminder records found matching the current search or tab filter.
                      </td>
                    </tr>
                  ) : (
                    filteredLogs.map((log, index) => {
                      const isPending = log.status === "pending";
                      const isSent = log.status === "sent";

                      return (
                        <tr key={log.id} className={!log.isMatched ? "row-unmatched" : ""}>
                          <td>{index + 1}</td>
                          <td>
                            <strong className="invoice-no-text">{log.invoiceNumber || "N/A"}</strong>
                            <div className="text-muted-sm">{log.billAgeDays ? `Age: ${log.billAgeDays} days` : ""}</div>
                          </td>
                          <td>
                            <div className="dealer-name-cell">
                              <strong>{log.dealerName || "Unknown Dealer"}</strong>
                              <span className="badge-dealer-code">{log.dealerCode || "No Code"}</span>
                            </div>
                          </td>
                          <td>
                            <span className="stage-badge">{log.selectedAgeingStage || log.reminderType || `Rule Day ${log.reminderDay}`}</span>
                          </td>
                          <td>
                            <span>{log.contactName || "Accounts Team"}</span>
                          </td>
                          <td>
                            {log.isMatched ? (
                              <span className="status-badge-gen matched">
                                🟢 Matched
                              </span>
                            ) : (
                              <span className="status-badge-gen missing" title={log.matchReason}>
                                🔴 Missing Contact
                              </span>
                            )}
                          </td>
                          <td>
                            <div className="channel-recipient-cell">
                              <ChannelLabel channel={log.channel} />
                              <span className="recipient-text">
                                {isAdmin
                                  ? log.isMatched
                                    ? log.recipient
                                    : log.recipient || "No recipient"
                                  : "Hidden"}
                              </span>
                            </div>
                          </td>
                          <td>
                            <strong>{formatCurrency(log.relevantAmount || log.totalOutstanding || 0)}</strong>
                            {log.totalOutstanding && log.relevantAmount && log.totalOutstanding !== log.relevantAmount ? (
                              <div className="text-muted-sm">Total: {formatCurrency(log.totalOutstanding)}</div>
                            ) : null}
                          </td>
                          <td>
                            <span
                              className={`status-pill ${
                                isSent ? "status-sent" : isPending ? "status-pending" : "status-failed"
                              }`}
                            >
                              {log.status}
                            </span>
                          </td>
                          <td>
                            <span className="note-cell-text">
                              {log.matchReason || log.failureReason || (isPending ? "Queued for dispatch" : isSent ? "Delivered" : "-")}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Modal Footer */}
            <div className="generation-modal-footer">
              <div className="gen-footer-left">
                {stats.missing > 0 && (
                  <span className="gen-footer-warning">
                    ⚠️ {stats.missing} reminder{stats.missing === 1 ? "" : "s"} cannot be sent due to missing contact details.{" "}
                    <Link href="/dashboard/master" className="link-underline" onClick={() => setIsOpen(false)}>
                      Update Master Contacts ↗
                    </Link>
                  </span>
                )}
              </div>
              <div className="gen-footer-right">
                <button type="button" className="button button-secondary" onClick={() => setIsOpen(false)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
