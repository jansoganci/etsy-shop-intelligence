import { useState, type PropsWithChildren, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import "./collapsible.css";

type CollapsibleProps = PropsWithChildren<{
  title: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}>;

export function Collapsible({ title, defaultOpen = false, className, children }: CollapsibleProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const classes = ["collapsible", className ?? ""].filter(Boolean).join(" ");

  return (
    <div className={classes}>
      <button
        type="button"
        className="collapsible__trigger"
        onClick={() => setIsOpen((current) => !current)}
        aria-expanded={isOpen}
      >
        <span className="collapsible__title">{title}</span>
        <ChevronDown
          size={16}
          className={`collapsible__chevron${isOpen ? " collapsible__chevron--open" : ""}`}
          aria-hidden="true"
        />
      </button>
      {isOpen ? <div className="collapsible__content">{children}</div> : null}
    </div>
  );
}
