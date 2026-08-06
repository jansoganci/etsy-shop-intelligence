import type { TextareaHTMLAttributes } from "react";
import "./form-controls.css";

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label?: string;
  help?: string;
  showCount?: boolean;
};

export function Textarea({
  label,
  help,
  showCount,
  className,
  maxLength,
  value,
  ...props
}: TextareaProps) {
  const shouldShowCount = showCount ?? Boolean(maxLength);
  const currentLength = typeof value === "string" ? value.length : 0;

  const control = (
    <textarea
      className={["field__control", className ?? ""].filter(Boolean).join(" ")}
      maxLength={maxLength}
      value={value}
      {...props}
    />
  );

  if (!label && !help && !shouldShowCount) {
    return control;
  }

  return (
    <label className="field">
      {label ? <span className="field__label">{label}</span> : null}
      {control}
      {shouldShowCount && maxLength ? (
        <small className="field__count">
          {currentLength}/{maxLength}
        </small>
      ) : null}
      {help ? <small className="field__help">{help}</small> : null}
    </label>
  );
}
