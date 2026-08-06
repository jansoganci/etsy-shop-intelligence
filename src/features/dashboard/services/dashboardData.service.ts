import { fetchImportsHistory } from "../../../data/api/imports.api";
import type { CsvReportType, ImportRecord } from "../../../data/models/records";

function mapImportType(importType: string): CsvReportType {
  if (importType === "payments") {
    return "direct_checkout_payments";
  }

  if (importType === "orders") {
    return "sold_orders";
  }

  return "sold_order_items";
}

export async function getImportsHistory(): Promise<ImportRecord[]> {
  const importsHistory = await fetchImportsHistory();

  return importsHistory.map((item) => ({
    id: String(item.id),
    fileName: item.fileName ?? "Unknown file",
    importedAt: item.importedAt,
    reportType: mapImportType(item.importType),
    rowCount: item.rowCount,
    importedCount: item.rowCount,
    duplicateCount: 0,
    detectedColumns: [],
    status: item.status,
    errorMessage: item.errorMessage,
  }));
}
