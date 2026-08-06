export type CsvReportType =
  | "direct_checkout_payments"
  | "sold_order_items"
  | "sold_orders";

export type ImportRecord = {
  id: string;
  fileName: string;
  importedAt: string;
  reportType: CsvReportType;
  rowCount: number;
  importedCount: number;
  duplicateCount: number;
  detectedColumns: string[];
  status?: string;
  errorMessage?: string | null;
};

export type CsvImportResult = {
  rowCount: number;
  importedCount: number;
  duplicateCount: number;
  invalidRowCount: number;
  importRecord: ImportRecord;
};

export type CsvRow = Record<string, string>;
