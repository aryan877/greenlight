import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

type Theme = "light" | "dark";

const themeStorageKey = "greenlight:theme";

const initialTheme = (): Theme => {
  try {
    const stored = window.localStorage.getItem(themeStorageKey);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // The system preference still provides a stable fallback.
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
};

export const ThemeToggle = () => {
  const [theme, setTheme] = useState<Theme>(initialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem(themeStorageKey, theme);
    } catch {
      // Theme switching still works for this session.
    }
  }, [theme]);

  const nextTheme = theme === "light" ? "dark" : "light";
  const Icon = theme === "light" ? Moon : Sun;

  return (
    <button
      type="button"
      aria-label={`Switch to ${nextTheme} mode`}
      title={`Switch to ${nextTheme} mode`}
      onClick={() => setTheme(nextTheme)}
      className="grid size-8 place-items-center border border-line-subtle text-ink-tertiary transition-colors hover:border-line-strong hover:bg-hover hover:text-ink"
    >
      <Icon size={14} strokeWidth={1.8} />
    </button>
  );
};
