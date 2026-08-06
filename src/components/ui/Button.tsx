import "./button.css";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md";
  icon?: ReactNode;
};

export function Button({
  variant = "secondary",
  size = "md",
  icon,
  className,
  children,
  ...props
}: ButtonProps) {
  const classes = [
    "button",
    "ui-button",
    variant === "primary" ? "ui-button--primary" : "",
    variant === "ghost" ? "ui-button--ghost" : "",
    size === "sm" ? "ui-button--sm" : "ui-button--md",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button className={classes} {...props}>
      {icon ? <span className="ui-button__icon">{icon}</span> : null}
      <span>{children}</span>
    </button>
  );
}
