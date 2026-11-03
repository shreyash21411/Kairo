interface ThemeToggleProps {
  theme: "dark" | "light";
  onChange: (theme: "dark" | "light") => void;
}

export default function ThemeToggle({ theme, onChange }: ThemeToggleProps) {
  const isDark = theme === "dark";

  return (
    <div
      className="vz-theme-segmented"
      role="radiogroup"
      aria-label="Theme selection"
    >
      {/* Sliding indicator */}
      <span
        className={`vz-theme-indicator ${isDark ? "is-dark" : "is-light"}`}
        aria-hidden="true"
      />

      {/* Dark theme button */}
      <button
        type="button"
        role="radio"
        aria-checked={isDark}
        className={`vz-theme-btn ${isDark ? "is-active" : ""}`}
        onClick={() => onChange("dark")}
        title="Switch to Dark theme"
        aria-label="Dark theme"
      >
        <svg
          className="vz-theme-icon"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
        </svg>
        <span className="vz-theme-btn-label">Dark</span>
      </button>

      {/* Light theme button */}
      <button
        type="button"
        role="radio"
        aria-checked={!isDark}
        className={`vz-theme-btn ${!isDark ? "is-active" : ""}`}
        onClick={() => onChange("light")}
        title="Switch to Light theme"
        aria-label="Light theme"
      >
        <svg
          className="vz-theme-icon"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="10" cy="10" r="4" />
          <path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.34 4.34l1.42 1.42M14.24 14.24l1.42 1.42M4.34 15.66l1.42-1.42M14.24 5.76l1.42-1.42" />
        </svg>
        <span className="vz-theme-btn-label">Light</span>
      </button>
    </div>
  );
}
