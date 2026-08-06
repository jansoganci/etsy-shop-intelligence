import "./theme-toggle.css";

type ThemeToggleProps = {
  theme: "dark" | "light";
  onToggle: () => void;
  id?: string;
};

export function ThemeToggle({ theme, onToggle, id = "theme-switch" }: ThemeToggleProps) {
  const isDark = theme === "dark";

  return (
    <div className="theme-switch">
      <label className="switch" htmlFor={id}>
        <input
          id={id}
          className="switch__input"
          type="checkbox"
          role="switch"
          checked={isDark}
          onChange={onToggle}
          aria-checked={isDark}
        />
        <svg
          className="switch__icon switch__icon--light"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />
          <polyline points="12 2 12 5" />
          <polyline points="12 19 12 22" />
          <polyline points="2 12 5 12" />
          <polyline points="19 12 22 12" />
          <polyline points="4.22 4.22 6.34 6.34" />
          <polyline points="17.66 17.66 19.78 19.78" />
          <polyline points="4.22 19.78 6.34 17.66" />
          <polyline points="17.66 6.34 19.78 4.22" />
        </svg>
        <svg
          className="switch__icon switch__icon--dark"
          viewBox="0 0 24 24"
          fill="currentColor"
          stroke="none"
          aria-hidden="true"
        >
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
        <span className="switch__sr">
          {isDark ? "Dark mode on" : "Light mode on"}
        </span>
      </label>
    </div>
  );
}
