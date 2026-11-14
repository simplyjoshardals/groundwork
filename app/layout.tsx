import type { Metadata } from "next";
import { Geist_Mono, Instrument_Sans, Newsreader } from "next/font/google";
import { THEME_SCRIPT } from "@/lib/theme/theme-script";
import "./globals.css";

// Serif for answers and headings. One variable file covers every weight;
// italic is not loaded (add it only when something uses it).
const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  display: "swap",
});

// Sans for UI. Preloaded, like the serif: both show on first paint.
const instrumentSans = Instrument_Sans({
  variable: "--font-instrument",
  subsets: ["latin"],
  display: "swap",
});

// Mono for page refs and numbers. Not preloaded: it is rarely above the fold.
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  weight: "variable",
  display: "swap",
  preload: false,
});

export const metadata: Metadata = {
  title: {
    default: "Groundwork: ask your documents, see the source",
    template: "%s · Groundwork",
  },
  description:
    "Ask your documents a question. Every claim links to the exact page, highlighted. If it isn’t in your documents, it says so.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // `suppressHydrationWarning`: the inline script sets `data-theme` before
    // React hydrates, so the server HTML and the DOM differ on that attribute.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${newsreader.variable} ${instrumentSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
