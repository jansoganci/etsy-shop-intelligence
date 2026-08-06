import type { PropsWithChildren } from "react";

type PageSectionProps = PropsWithChildren<{
  className?: string;
  gap?: "sm" | "md" | "lg";
}>;

const GAP_CLASS_MAP: Record<NonNullable<PageSectionProps["gap"]>, string> = {
  sm: "page-section--sm",
  md: "page-section--md",
  lg: "page-section--lg",
};

export function PageSection({ children, className, gap = "md" }: PageSectionProps) {
  const classes = ["page-section", GAP_CLASS_MAP[gap], className].filter(Boolean).join(" ");

  return <section className={classes}>{children}</section>;
}
