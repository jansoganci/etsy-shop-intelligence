import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import { fetchImportStatus, uploadCsvToApi } from "../../data/api/imports.api";
import { getImportsHistory } from "../../features/dashboard/services/dashboardData.service";
import {
  CsvImportSession,
  INITIAL_IMPORT_SESSION_STATE,
  type ImportSessionState,
} from "../../features/csvImport/importSession";
import type { CsvReportType, ImportRecord } from "../../data/models/records";

type DashboardDataContextValue = {
  imports: ImportRecord[];
  isLoading: boolean;
  error: string | null;
  clearError: () => void;
  importSession: ImportSessionState;
  isImporting: boolean;
  /** Increments once per successful import completion; a stable dependency for effects that should refetch after an import lands. */
  importCompletionCount: number;
  startImport: (file: File, reportType: CsvReportType) => Promise<void>;
  retryImport: () => Promise<void>;
  closeImportSession: () => void;
};

const BUSY_STAGES = new Set<ImportSessionState["stage"]>(["uploading", "importing", "processing"]);

const DashboardDataContext = createContext<DashboardDataContextValue | null>(null);

export function DashboardDataProvider({ children }: PropsWithChildren) {
  const [imports, setImports] = useState<ImportRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [importSession, setImportSession] = useState<ImportSessionState>(INITIAL_IMPORT_SESSION_STATE);
  const [importCompletionCount, setImportCompletionCount] = useState(0);

  const refreshImports = async () => {
    const nextImports = await getImportsHistory();
    setImports(nextImports);
  };

  useEffect(() => {
    refreshImports()
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : "Failed to load import history.");
      })
      .finally(() => setIsLoading(false));
  }, []);

  const refreshImportsRef = useRef(refreshImports);
  refreshImportsRef.current = refreshImports;

  const sessionRef = useRef<CsvImportSession | null>(null);
  if (!sessionRef.current) {
    sessionRef.current = new CsvImportSession({
      uploadCsv: uploadCsvToApi,
      fetchStatus: fetchImportStatus,
      onTerminal: async (state) => {
        if (state.stage === "completed") {
          // Refresh Data Center's import history now that the import has landed.
          await refreshImportsRef.current().catch(() => {
            // A failed post-import refresh shouldn't hide a successful import;
            // the next navigation/poll will pick up fresh data.
          });
          setImportCompletionCount((count) => count + 1);
        }
      },
    });
  }

  useEffect(() => {
    const session = sessionRef.current;
    if (!session) {
      return;
    }
    setImportSession(session.getState());
    return session.subscribe(setImportSession);
  }, []);

  useEffect(() => () => sessionRef.current?.stop(), []);

  const value = useMemo(
    () => ({
      imports,
      isLoading,
      error,
      clearError: () => setError(null),
      importSession,
      isImporting: BUSY_STAGES.has(importSession.stage),
      importCompletionCount,
      startImport: (file: File, reportType: CsvReportType) =>
        sessionRef.current!.start(file, reportType),
      retryImport: () => sessionRef.current!.retry(),
      closeImportSession: () => sessionRef.current!.reset(),
    }),
    [imports, isLoading, error, importSession, importCompletionCount],
  );

  return <DashboardDataContext.Provider value={value}>{children}</DashboardDataContext.Provider>;
}

export function useDashboardData() {
  const context = useContext(DashboardDataContext);

  if (!context) {
    throw new Error("useDashboardData must be used within DashboardDataProvider");
  }

  return context;
}
