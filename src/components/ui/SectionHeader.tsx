import type { ReactNode } from "react";

type SectionHeaderProps = {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  className?: string;
};

export function SectionHeader({ title, subtitle, actions, className }: SectionHeaderProps) {
  const classes = ["section-header", "panel__header", className ?? ""].filter(Boolean).join(" ");

  return (
    <header className={classes}>
      <div>
        <h3 className="section-header__title">{title}</h3>
        {subtitle ? <p className="section-header__subtitle">{subtitle}</p> : null}
      </div>
      {actions ? <div className="section-header__actions">{actions}</div> : null}
    </header>
  );
}
