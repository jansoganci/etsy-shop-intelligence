import type { ReactNode } from "react";
import "./page-header.css";

type PageHeaderProps = {
  eyebrow?: string;
  title: string;
  subtitle: string;
  actions?: ReactNode;
};

export function PageHeader({ eyebrow, title, subtitle, actions }: PageHeaderProps) {
  return (
    <header className="page-header header-bar header-bar--shell">
      <div className="page-header__copy">
        {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {actions ? <div className="page-header__actions">{actions}</div> : null}
    </header>
  );
}
