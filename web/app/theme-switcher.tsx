"use client";

import { useSyncExternalStore } from "react";

export type Theme = "system" | "light" | "dark";
const OPTIONS: { value: Theme; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") delete root.dataset.theme;
  else root.dataset.theme = theme;
  try {
    if (theme === "system") localStorage.removeItem("theme");
    else localStorage.setItem("theme", theme);
  } catch {
    // Storage blocked (private window etc.): the choice still applies for this visit.
  }
}

// The page's current theme lives on <html data-theme> (set before paint by layout.tsx).
function readTheme(): Theme {
  const t = document.documentElement.dataset.theme;
  return t === "light" || t === "dark" ? t : "system";
}

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

export function ThemeSwitcher() {
  const theme = useSyncExternalStore(subscribe, readTheme, () => "system" as Theme);

  return (
    <fieldset className="flex flex-wrap items-center gap-3">
      <legend className="sr-only">Appearance</legend>
      <span aria-hidden="true" className="text-sm font-semibold uppercase tracking-wider text-muted">
        Appearance
      </span>
      <div className="inline-flex rounded-full border border-line bg-surface p-1 shadow-card">
        {OPTIONS.map((o) => (
          <label
            key={o.value}
            className="cursor-pointer rounded-full px-4 py-1.5 text-base text-muted transition-colors hover:text-fg has-[:checked]:bg-accent has-[:checked]:text-on-accent has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent"
          >
            <input
              type="radio"
              name="theme"
              value={o.value}
              checked={theme === o.value}
              onChange={() => applyTheme(o.value)}
              className="sr-only"
            />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
