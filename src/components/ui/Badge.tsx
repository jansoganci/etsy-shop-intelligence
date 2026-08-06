import "./badge.css";
import type { PropsWithChildren } from "react";

type BadgeProps = PropsWithChildren<{
  variant?: "neutral" | "success" | "warning" | "error" | "accent";
  size?: "sm" | "md";
  className?: string;
}>;

export function Badge({ variant = "neutral", size = "sm", className, children }: BadgeProps) {
  const classes = [
    "badge",
    `badge--${variant}`,
    size === "md" ? "badge--md" : "badge--sm",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return <span className={classes}>{children}</span>;
}
