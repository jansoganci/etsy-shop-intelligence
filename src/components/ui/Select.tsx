import type { SelectHTMLAttributes } from "react";
import "./form-controls.css";

type SelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "children"> & {
  label?: string;
  help?: string;
  options: SelectOption[];
};

export function Select({ label, help, options, className, id, ...props }: SelectProps) {
  const control = (
    <select id={id} className={["field__control", className ?? ""].filter(Boolean).join(" ")} {...props}>
      {options.map((option) => (
        <option key={option.value} value={option.value} disabled={option.disabled}>
          {option.label}
        </option>
      ))}
    </select>
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
