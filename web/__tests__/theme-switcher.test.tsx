import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeToggle } from "@/app/theme-switcher";

const root = () => document.documentElement;

function mockOsDark(dark: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: dark, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
}

beforeEach(() => {
  delete root().dataset.theme;
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("Theme toggle", () => {
  it("is one labelled icon button that follows the OS until clicked", () => {
    mockOsDark(false);
    render(<ThemeToggle />);
    expect(screen.getByRole("button", { name: "Switch to dark mode" })).toBeInTheDocument();
    expect(root().dataset.theme).toBeUndefined();
  });

  it("offers light mode when the OS is dark", () => {
    mockOsDark(true);
    render(<ThemeToggle />);
    expect(screen.getByRole("button", { name: "Switch to light mode" })).toBeInTheDocument();
  });

  it("switches between dark and light and remembers the choice", async () => {
    mockOsDark(false);
    render(<ThemeToggle />);
    await userEvent.click(screen.getByRole("button", { name: "Switch to dark mode" }));
    expect(root().dataset.theme).toBe("dark");
    expect(localStorage.getItem("theme")).toBe("dark");

    await userEvent.click(screen.getByRole("button", { name: "Switch to light mode" }));
    expect(root().dataset.theme).toBe("light");
    expect(localStorage.getItem("theme")).toBe("light");
  });

  it("shows the theme already applied before the page loaded", () => {
    root().dataset.theme = "dark";
    render(<ThemeToggle />);
    expect(screen.getByRole("button", { name: "Switch to light mode" })).toBeInTheDocument();
  });

  it("works with the keyboard", async () => {
    render(<ThemeToggle />);
    await userEvent.tab();
    await userEvent.keyboard("{Enter}");
    expect(root().dataset.theme).toBe("dark");
  });
});
