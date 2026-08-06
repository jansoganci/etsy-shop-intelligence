import { NavLink } from "react-router-dom";
import "../data-center.css";

const ITEMS = [
  { to: "/data-center", end: true, label: "Overview" },
  { to: "/data-center/sync", label: "Sync" },
  { to: "/data-center/imports", label: "Imports & Stats" },
  { to: "/data-center/reconciliation", label: "Reconciliation" },
  { to: "/data-center/reviews", label: "Reviews" },
  { to: "/data-center/financial-controls", label: "Financial Controls" },
];

export function DataCenterNavigation() {
  return (
    <nav className="data-center-nav" aria-label="Data Center bölümleri">
      {ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          // Avoid focus-driven scrollIntoView jumping the sticky/overflow tab strip.
          onMouseDown={(event) => event.preventDefault()}
          className={({ isActive }) =>
            `data-center-nav__link${isActive ? " data-center-nav__link--active" : ""}`
          }
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}
