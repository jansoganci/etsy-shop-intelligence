import { useMemo } from "react";

export type ChartRow = Record<string, unknown>;

const PERCENT_KEY_PATTERN = /(rate|share|percent)$/i;
const TITLE_KEY_PATTERN = /title/i;

export function asChartRows(value: unknown): ChartRow[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((row): row is ChartRow => typeof row === "object" && row !== null);
}

function formatCellValue(value: unknown, columnKey: string): string {
  if (value === null || value === undefined || value === "") {
    return "N/A";
  }

  if (typeof value === "number") {
    if (PERCENT_KEY_PATTERN.test(columnKey)) {
      return `${(value * 100).toFixed(1)}%`;
    }

    return Number.isInteger(value)
      ? new Intl.NumberFormat("en-US").format(value)
      : new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
  }

  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  return String(value);
}

function toTitleCase(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([a-zA-Z])(\d)/g, "$1 $2")
    .replace(/(\d)([A-Za-z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getColumns(rows: ChartRow[]): string[] {
  return Array.from(
    rows.reduce((keys, row) => {
      for (const key of Object.keys(row)) {
        keys.add(key);
      }

      return keys;
    }, new Set<string>()),
  );
}

export function SimpleChartTable({
  rows,
  emptyMessage,
}: {
  rows: ChartRow[];
  emptyMessage: string;
}) {
  const columns = useMemo(() => getColumns(rows), [rows]);

  if (rows.length === 0 || columns.length === 0) {
    return <p className="status-card">{emptyMessage}</p>;
  }

  return (
    <div className="table-wrap">
      <table className="data-table report-simple-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{toTitleCase(column)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={`chart-row-${rowIndex}`}>
              {columns.map((column) => {
                const value = row[column];
                const isTitleColumn = TITLE_KEY_PATTERN.test(column) && typeof value === "string";

                return (
                  <td key={`${rowIndex}-${column}`}>
                    {isTitleColumn ? (
                      <span className="report-simple-table__truncate" title={value as string}>
                        {value as string}
                      </span>
                    ) : (
                      formatCellValue(value, column)
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
