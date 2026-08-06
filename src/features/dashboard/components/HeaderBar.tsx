import type { ReactNode } from "react";
import { PageHeader } from "../../../components/ui";

type HeaderBarProps = {
  eyebrow?: string;
  title: string;
  subtitle: string;
  actions?: ReactNode;
};

export function HeaderBar({ eyebrow, title, subtitle, actions }: HeaderBarProps) {
  return <PageHeader eyebrow={eyebrow} title={title} subtitle={subtitle} actions={actions} />;
}
