import type { Metadata, Viewport } from "next";
import "./globals.css";
import { cn } from "cn";
import {
  PWA_APPLE_TOUCH_ICON_PATH,
  PWA_NAME,
  PWA_THEME_COLOR,
} from "@/lib/pwa/app-identity";

export const metadata: Metadata = {
  title: "stage-tracker",
  description: "stage-tracker v2",
  icons: {
    apple: [{ url: PWA_APPLE_TOUCH_ICON_PATH }],
  },
  appleWebApp: {
    capable: true,
    title: PWA_NAME,
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: PWA_THEME_COLOR,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja" className={cn("h-full antialiased", "font-sans")}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
