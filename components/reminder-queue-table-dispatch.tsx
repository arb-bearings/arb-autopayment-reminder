"use client";

import { useMemo, useState, useEffect } from "react";
import type { ReminderLog, DueRecord, ReminderRule } from "@/lib/types";
import { ChannelLabel } from "./channel-label";
import { formatDate } from "@/lib/utils";

interface ReminderQueueTableDispatchProps {
  reminderLogs: ReminderLog[];
  dueRecords: DueRecord[];
  rules: ReminderRule[];
  isAdmin: boolean;
}

export function ReminderQueueTableDispatch({
  reminderLogs,
  dueRecords,
  rules,
  isAdmin
}: ReminderQueueTableDispatchProps) {
  const pendingLogIds = useMemo(() => {
    return reminderLogs.filter((log) => log.status === "pending").map((log) => log.id);
  }, [reminderLogs]);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(pendingLogIds));

  // Reset/sync selection to select all pending logs when logs change
  useEffect(() => {
    setSelectedIds(new Set(pendingLogIds));
  }, [pendingLogIds]);

  const dueRecordMap = useMemo(() => new Map(dueRecords.map((entry) => [entry.id, entry])), [dueRecords]);
  const ruleMap = useMemo(() => new Map(rules.map((entry) => [entry.id, entry])), [rules]);

  const isAllChecked = pendingLogIds.length > 0 && selectedIds.size === pendingLogIds.length;

  const toggleAll = () => {
    if (isAllChecked) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(pendingLogIds));
    }
  };

  const toggleOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <>
      {/* Hidden inputs to submit selected logIds */}
      {Array.from(selectedIds).map((id) => (
        <input key={id} type="hidden" name="logIds" value={id} />
      ))}

      <div className="table-wrap dispatch-table-wrap">
        <table className="dispatch-table" data-searchable-table>
          <thead>
            <tr>
              <th style={{ width: "40px", textAlign: "center" }}>
                {pendingLogIds.length > 0 ? (
                  <input
                    type="checkbox"
                    checked={isAllChecked}
                    onChange={toggleAll}
                    style={{ cursor: "pointer" }}
                  />
                ) : (
                  <input type="checkbox" disabled checked={false} />
                )}
              </th>
              <th>No.</th>
              <th>Invoice</th>
              <th>Company</th>
              <th>Rule</th>
              <th>Channel</th>
              <th>Recipient</th>
              <th>Status</th>
              <th>Scheduled</th>
              <th>CD</th>
              <th>Failure / CD note</th>
            </tr>
          </thead>
          <tbody>
            {reminderLogs.length === 0 ? (
              <tr>
                <td colSpan={11}>Upload a dues file to populate the queue.</td>
              </tr>
            ) : (
              reminderLogs.map((log, index) => {
                const due = dueRecordMap.get(log.dueId);
                const rule = ruleMap.get(log.ruleId);
                const isPending = log.status === "pending";

                return (
                  <tr key={log.id}>
                    <td style={{ textAlign: "center" }}>
                      {isPending ? (
                        <input
                          type="checkbox"
                          checked={selectedIds.has(log.id)}
                          onChange={() => toggleOne(log.id)}
                          style={{ cursor: "pointer" }}
                        />
                      ) : (
                        <input type="checkbox" disabled checked={false} />
                      )}
                    </td>
                    <td>{index + 1}</td>
                    <td>{due?.invoiceNumber || due?.reference || due?.companyName || "N/A"}</td>
                    <td>
                      <div className="dispatch-company-cell">
                        <span>{due?.companyName || log.dealerCode || "N/A"}</span>
                        <span
                          className={`dispatch-badge ${
                            log.cdEligible
                              ? "dispatch-badge-cd"
                              : "dispatch-badge-cd dispatch-badge-cd-muted"
                          }`}
                        >
                          {log.cdEligible ? `CD ${log.cdDiscountPercent}%` : "No CD"}
                        </span>
                      </div>
                    </td>
                    <td>{rule?.name || "Unknown rule"}</td>
                    <td>
                      <ChannelLabel channel={log.channel} />
                    </td>
                    <td>{isAdmin ? log.recipient : "Hidden"}</td>
                    <td>
                      <span className={`dispatch-badge dispatch-status-${log.status}`}>
                        {log.status}
                      </span>
                    </td>
                    <td>{formatDate(log.scheduledFor)}</td>
                    <td>
                      {log.cdEligible ? `${log.cdDiscountPercent}% eligible` : "Not eligible"}
                    </td>
                    <td>{log.failureReason || log.cdReason || "-"}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
