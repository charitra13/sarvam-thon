import "./globals.css";

// OCR + LLM + TTS calls run inside server actions; give them room on Vercel.
export const maxDuration = 60;

export const metadata = {
  title: "Munshi · slip to ledger",
  description: "Handwritten invoice slips to digital records, inventory, ledger and Hinglish voice calls, powered by Sarvam AI.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
