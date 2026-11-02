import { Young_Serif, Hanken_Grotesk, IBM_Plex_Mono, Kalam } from "next/font/google";
import "./globals.css";

const display = Young_Serif({ subsets: ["latin"], weight: "400", variable: "--font-display" });
const body = Hanken_Grotesk({ subsets: ["latin"], variable: "--font-body" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-mono" });
const hand = Kalam({ subsets: ["latin", "devanagari"], weight: ["400", "700"], variable: "--font-hand" });

// OCR + LLM + TTS calls run inside server actions; give them room on Vercel.
export const maxDuration = 60;

export const metadata = {
  title: "Munshi · slip to ledger",
  description: "Handwritten invoice slips to digital records, inventory, ledger and Hinglish voice calls, powered by Sarvam AI.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable} ${hand.variable}`}>
      <body>{children}</body>
    </html>
  );
}
