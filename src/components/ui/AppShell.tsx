import type { PropsWithChildren } from "react";
import { LevelBar } from "./LevelBar";
import { SidebarInset, SidebarProviderShell, SidebarTrigger } from "./sidebar";

type AppShellProps = PropsWithChildren;

export function AppShell({ children }: AppShellProps) {
  return (
    <SidebarProviderShell className="app-shell dashboard-layout">
      {children}
    </SidebarProviderShell>
  );
}

type AppShellMainProps = PropsWithChildren;

export function AppShellMain({ children }: AppShellMainProps) {
  return (
    <SidebarInset className="app-shell__content dashboard-content">
      <div className="app-shell__toolbar">
        <SidebarTrigger />
        <LevelBar />
      </div>
      <main className="app-shell__main dashboard-main">{children}</main>
    </SidebarInset>
  );
}
