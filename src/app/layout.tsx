/**
 * Root layout.
 *
 * Deliberately bare. The app shell — 240px sidebar, 56px top bar, right drawer (§4.1, §7.3) —
 * arrives with the first authenticated screen. Login sits outside it, so building the shell now
 * would mean building something nothing yet uses.
 */

import type { Metadata } from "next";
import { Inter } from "next/font/google";

import "./globals.css";

/**
 * §7.2: "Inter is required for font-variant-numeric: tabular-nums. Any substitute must have real
 * tabular figures." Loaded at the root because every screen after this one is full of numbers a QS
 * reads down a column.
 */
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Mzilikazi QS Platform",
  description:
    "Measure a building, produce a priced Bill of Quantities, and issue payment certificates against it.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-ZA" className={`${inter.variable} h-full antialiased`}>
      <body className="h-dvh">{children}</body>
    </html>
  );
}
