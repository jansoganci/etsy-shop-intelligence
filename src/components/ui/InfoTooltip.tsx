import { Info } from "lucide-react";
import type { PropsWithChildren } from "react";

type InfoTooltipProps = PropsWithChildren<{
  label?: string;
}>;

export function InfoTooltip({ label = "More info", children }: InfoTooltipProps) {
  return (
    <button type="button" className="info-tooltip" aria-label={label}>
      <Info size={13} aria-hidden="true" />
      <span role="tooltip" className="info-tooltip__bubble">
        {children}
      </span>
    </button>
  );
}
