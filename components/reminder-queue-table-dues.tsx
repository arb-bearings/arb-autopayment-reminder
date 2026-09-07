"use client";

import { useMemo, useState, useEffect } from "react";
import type { ReminderLog } from "@/lib/types";
import { ChannelLabel } from "./channel-label";
import { formatDate } from "@/lib/utils";

interface ReminderQueueTableDuesProps {
  reminderLogs: ReminderLog[];
  isAdmin: boolean;
  statusFilter: string;
  channelFilter: string;
}

export function ReminderQueueTableDues({
  reminderLogs,
  isAdmin,
  statusFilter,
  channelFilter
}: ReminderQueueTableDuesProps) {
  const pendingLogIds = useMemo(() => {
    return reminderLogs.filter((log) => log.status === "pending").map((log) => log.id);
  }, [reminderLogs]);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(pendingLogIds));

  // Reset/sync selection to select all pending logs when logs change
  useEffect(() => {
    setSelectedIds(new Set(pendingLogIds));
  }, [pendingLogIds]);

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

      <div className="table-wrap">
        <table data-searchable-table>
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
              <th>Dealer</th>
              <th>Channel</th>
              <th>Recipient</th>
              <th>Status</th>
              <th>Scheduled</th>
              <th>Failure</th>
            </tr>
          </thead>
          <tbody>
            {reminderLogs.length === 0 ? (
              <tr>
                <td colSpan={9}>
                  {statusFilter || channelFilter
                    ? "No reminder records match this filter."
                    : "No reminders have been generated yet."}
                </td>
              </tr>
            ) : (
              reminderLogs.slice(0, 100).map((log, index) => {
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
                    <td>{log.invoiceNumber || "N/A"}</td>
                    <td>{log.dealerCode || "N/A"}</td>
                    <td>
                      <ChannelLabel channel={log.channel} />
                    </td>
                    <td>{isAdmin ? log.recipient || "N/A" : "Hidden"}</td>
                    <td className="capitalize">{log.status}</td>
                    <td>{formatDate(log.scheduledFor)}</td>
                    <td>{log.failureReason || "-"}</td>
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
