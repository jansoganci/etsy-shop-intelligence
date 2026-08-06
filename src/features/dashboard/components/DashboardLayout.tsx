import type { PropsWithChildren, ReactNode } from "react";
import { AppShell, AppShellMain } from "../../../components/ui";

type DashboardLayoutProps = PropsWithChildren<{
  sidebar: ReactNode;
}>;

export function DashboardLayout({ sidebar, children }: DashboardLayoutProps) {
  return (
    <AppShell>
      <aside className="app-shell__sidebar dashboard-sidebar">{sidebar}</aside>
      <AppShellMain>{children}</AppShellMain>
    </AppShell>
  );
}
