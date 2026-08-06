import type { InputHTMLAttributes } from "react";
import "./form-controls.css";

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  help?: string;
};

export function Input({ label, help, className, ...props }: InputProps) {
  const control = (
    <input className={["field__control", className ?? ""].filter(Boolean).join(" ")} {...props} />
  );

  if (!label && !help) {
    return control;
  }

  return (
    <label className="field">
      {label ? <span className="field__label">{label}</span> : null}
      {control}
      {help ? <small className="field__help">{help}</small> : null}
    </label>
  );
}
