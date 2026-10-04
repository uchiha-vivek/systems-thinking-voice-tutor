import type { Metadata } from "next";
import { Atkinson_Hyperlegible_Next, Newsreader } from "next/font/google";
import "./globals.css";

// Atkinson Hyperlegible was designed by the Braille Institute for low-vision readers.
const body = Atkinson_Hyperlegible_Next({ subsets: ["latin"], variable: "--font-atkinson" });
const display = Newsreader({ subsets: ["latin"], variable: "--font-newsreader", style: ["normal", "italic"] });

export const metadata: Metadata = {
  title: "Systems Thinking Voice Tutor",
  description: "A spoken, interactive tutor for causal loop and stock-and-flow diagrams.",
};

// Applies the saved theme before first paint so the page never flashes the wrong one.
const THEME_SCRIPT = `try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${body.variable} ${display.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
