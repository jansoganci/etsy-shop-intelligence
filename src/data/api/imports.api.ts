import type { ImportAcceptedResponse, ImportStatusResponse } from "../../features/csvImport/importSession";

export type BackendCsvType = "payments" | "orders" | "order_items";

export type BackendImportHistoryItem = {
  id: number;
  importType: string;
  declaredType?: string | null;
  detectedType?: string | null;
  fileName: string | null;
  fileHash?: string | null;
  rowCount: number;
  insertedCount?: number;
  replacedCount?: number;
  skippedCount?: number;
  errorCount?: number;
  status: string;
  startedAt?: string | null;
  completedAt?: string | null;
  failedAt?: string | null;
  importedAt: string;
  errorMessage: string | null;
};

type BackendImportsHistorySuccess = {
  ok: true;
  imports: BackendImportHistoryItem[];
};

type BackendCsvImportAcceptedBody = { ok: true } & ImportAcceptedResponse;
type BackendImportStatusBody = { ok: true } & ImportStatusResponse;

type BackendCsvImportFailure = {
  ok: false;
  error: string;
  message?: string;
  headers?: string[];
  importId?: number;
};

function formatImportError(data: BackendCsvImportFailure): string {
  if (data.error === "missing_file") {
    return "No file was uploaded.";
  }

  if (data.error === "unknown_csv_type") {
    return "This CSV does not match a supported Etsy report type.";
  }

  if (data.error === "declared_type_mismatch") {
    return data.message ?? "Selected report type does not match the uploaded CSV.";
  }

  if (data.error === "import_in_progress") {
    return data.message ?? "This file is already being imported.";
  }

  return data.message ?? "Unable to import this CSV file.";
}

export async function uploadCsvToApi(
  file: File,
  reportType?: string,
): Promise<ImportAcceptedResponse> {
  const formData = new FormData();
  formData.append("file", file);
  if (reportType) {
    formData.append("declaredType", reportType);
  }

  let response: Response;

  try {
    response = await fetch("/api/imports/csv", {
      method: "POST",
      body: formData,
    });
  } catch {
    throw new Error("Network error while uploading CSV.");
  }

  let data: BackendCsvImportAcceptedBody | BackendCsvImportFailure;

  try {
    data = (await response.json()) as BackendCsvImportAcceptedBody | BackendCsvImportFailure;
  } catch {
    throw new Error("Server returned an invalid response.");
  }

  if (!response.ok || !data.ok) {
    throw new Error(formatImportError(data as BackendCsvImportFailure));
  }

  return data;
}

export async function fetchImportStatus(importId: number): Promise<ImportStatusResponse> {
  let response: Response;

  try {
    response = await fetch(`/api/imports/${importId}`);
  } catch {
    throw new Error("Network error while checking import status.");
  }

  let data: BackendImportStatusBody | BackendCsvImportFailure;

  try {
    data = (await response.json()) as BackendImportStatusBody | BackendCsvImportFailure;
  } catch {
    throw new Error("Import status API returned an invalid response.");
  }

  if (!response.ok || !data.ok) {
    throw new Error("Failed to check import status.");
  }

  return data;
}

export async function fetchImportsHistory(): Promise<BackendImportHistoryItem[]> {
  let response: Response;

  try {
    response = await fetch("/api/imports");
  } catch {
    throw new Error("Network error while loading import history.");
  }

  let data: BackendImportsHistorySuccess | BackendCsvImportFailure;

  try {
    data = (await response.json()) as BackendImportsHistorySuccess | BackendCsvImportFailure;
  } catch {
    throw new Error("Import history API returned an invalid response.");
  }

  if (!response.ok || !data.ok) {
    throw new Error("Failed to load import history.");
  }

  return data.imports;
}
