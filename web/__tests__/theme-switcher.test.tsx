import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { ThemeSwitcher } from "@/app/theme-switcher";

const root = () => document.documentElement;

beforeEach(() => {
  delete root().dataset.theme;
  localStorage.clear();
});

describe("Theme switcher", () => {
  it("is a labelled group that defaults to System", () => {
    render(<ThemeSwitcher />);
    expect(screen.getByRole("group", { name: "Appearance" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "System" })).toBeChecked();
    expect(root().dataset.theme).toBeUndefined();
  });

  it("Light and Dark set the theme on the page and remember it", async () => {
    render(<ThemeSwitcher />);
    await userEvent.click(screen.getByRole("radio", { name: "Light" }));
    expect(root().dataset.theme).toBe("light");
    expect(localStorage.getItem("theme")).toBe("light");

    await userEvent.click(screen.getByRole("radio", { name: "Dark" }));
    expect(root().dataset.theme).toBe("dark");
    expect(localStorage.getItem("theme")).toBe("dark");
  });

  it("System goes back to following the OS and forgets the choice", async () => {
    render(<ThemeSwitcher />);
    await userEvent.click(screen.getByRole("radio", { name: "Dark" }));
    await userEvent.click(screen.getByRole("radio", { name: "System" }));
    expect(root().dataset.theme).toBeUndefined();
    expect(localStorage.getItem("theme")).toBeNull();
  });

  it("shows the theme already applied before the page loaded", () => {
    root().dataset.theme = "dark";
    render(<ThemeSwitcher />);
    expect(screen.getByRole("radio", { name: "Dark" })).toBeChecked();
  });

  it("arrow keys move between the options", async () => {
    render(<ThemeSwitcher />);
    await userEvent.tab();
    expect(screen.getByRole("radio", { name: "System" })).toHaveFocus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: "Light" })).toBeChecked();
    expect(root().dataset.theme).toBe("light");
  });
});
