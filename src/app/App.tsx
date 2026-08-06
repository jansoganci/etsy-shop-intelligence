import { useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { SidebarProvider } from "../components/ui/sidebar";
import { AiAnalystProvider } from "./providers/AiAnalystProvider";
import { useDashboardData } from "./providers/DashboardDataProvider";
import { useTheme } from "./providers/ThemeProvider";
import { AiAnalystPanel } from "../features/aiAnalyst/components/AiAnalystPanel";
import { CsvUploadModal } from "../features/csvImport/components/CsvUploadModal";
import { AppSidebar } from "../features/dashboard/components/AppSidebar";
import { DashboardLayout } from "../features/dashboard/components/DashboardLayout";
import { DashboardPage } from "../features/dashboard/pages/DashboardPage";
import { GoogleAnalyticsPage } from "../features/googleAnalytics/pages/GoogleAnalyticsPage";
import { CombinedAnalyticsPage } from "../features/combinedAnalytics/pages/CombinedAnalyticsPage";
import { DataCenterPage } from "../features/dataCenter/pages/DataCenterPage";
import { ImageStudioPage } from "../features/imageStudio/pages/ImageStudioPage";
import { ListingDetailPage } from "../features/listings/pages/ListingDetailPage";
import { ListingsPage } from "../features/listings/pages/ListingsPage";
import { ShopJournalPage } from "../features/shopJournal/pages/ShopJournalPage";
import { PaymentsReportPage } from "../features/reports/pages/PaymentsReportPage";
import { SoldOrderItemsReportPage } from "../features/reports/pages/SoldOrderItemsReportPage";
import { SoldOrdersReportPage } from "../features/reports/pages/SoldOrdersReportPage";

export function App() {
  const { theme, toggleTheme } = useTheme();
  const {
    imports,
    importSession,
    isImporting,
    startImport,
    retryImport,
    closeImportSession,
  } = useDashboardData();
  const [isUploadOpen, setIsUploadOpen] = useState(false);

  const openUploadModal = () => {
    setIsUploadOpen(true);
  };

  return (
    <AiAnalystProvider>
      <SidebarProvider>
        <DashboardLayout
          sidebar={
            <AppSidebar
              theme={theme}
              onToggleTheme={toggleTheme}
            />
          }
        >
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route
              path="/data-center/*"
              element={
                <DataCenterPage
                  imports={imports}
                  isImporting={isImporting}
                  onOpenCsvImport={openUploadModal}
                />
              }
            />
            <Route path="/listings" element={<ListingsPage />} />
            <Route path="/listings/:listingId" element={<ListingDetailPage />} />
            <Route path="/shop-journal" element={<ShopJournalPage />} />
            <Route path="/reports/payments" element={<PaymentsReportPage />} />
            <Route path="/reports/sold-orders" element={<SoldOrdersReportPage />} />
            <Route path="/reports/sold-order-items" element={<SoldOrderItemsReportPage />} />
            <Route path="/image-studio" element={<ImageStudioPage />} />
            <Route path="/google-analytics" element={<GoogleAnalyticsPage />} />
            <Route path="/combined-analytics" element={<CombinedAnalyticsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </DashboardLayout>

        <CsvUploadModal
          isOpen={isUploadOpen}
          session={importSession}
          imports={imports}
          onClose={() => setIsUploadOpen(false)}
          onStart={startImport}
          onRetry={retryImport}
          onReset={closeImportSession}
        />

        <AiAnalystPanel />
      </SidebarProvider>
    </AiAnalystProvider>
  );
}
