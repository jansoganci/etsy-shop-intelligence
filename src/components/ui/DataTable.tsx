import type { ReactNode } from "react";
import { DashboardCard } from "./DashboardCard";
import { SectionHeader } from "./SectionHeader";

type DataTableProps = {
  title: string;
  subtitle: string;
  columns: string[];
  rows: ReactNode[][];
  emptyMessage: string;
  compact?: boolean;
  className?: string;
};

export function DataTable({
  title,
  subtitle,
  columns,
  rows,
  emptyMessage,
  compact = false,
  className,
}: DataTableProps) {
  return (
    <DashboardCard
      className={["data-table-card", compact ? "data-table-card--compact" : "", className ?? ""]
        .filter(Boolean)
        .join(" ")}
      variant={compact ? "compact" : "default"}
    >
      <SectionHeader title={title} subtitle={subtitle} />
      {rows.length > 0 ? (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column}>{column}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={`${title}-${rowIndex}`}>
                  {row.map((cell, cellIndex) => (
                    <td key={`${title}-${rowIndex}-${cellIndex}`}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="status-card">{emptyMessage}</p>
      )}
    </DashboardCard>
  );
}
