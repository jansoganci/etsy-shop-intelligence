import type { ReactNode } from "react";
import { PageHeader } from "../../../components/ui";
import "../reports.css";

type ReportPageLayoutProps = {
  eyebrow?: string;
  title: string;
  description: string;
  actions?: ReactNode;
  filters?: ReactNode;
  tabs?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function ReportPageLayout({
  eyebrow,
  title,
  description,
  actions,
  filters,
  tabs,
  children,
  className,
}: ReportPageLayoutProps) {
  const classes = ["report-page-layout", className ?? ""].filter(Boolean).join(" ");

  return (
    <section className={classes}>
      <PageHeader eyebrow={eyebrow} title={title} subtitle={description} actions={actions} />
      {filters ? <div className="report-page-layout__filters">{filters}</div> : null}
      {tabs ? <div className="report-page-layout__tabs">{tabs}</div> : null}
      <div className="report-page-layout__content">{children}</div>
    </section>
  );
}
