import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { PWA_ICON_ASSETS, PWA_NAME, PWA_THEME_COLOR } from '@/pwa/appIdentity.ts';
import '@/ui/globals.css';

const appleTouchIcon = PWA_ICON_ASSETS.find((asset) => asset.role === 'apple-touch');

export const metadata: Metadata = {
  title: 'stage-tracker',
  description: 'stage-tracker consumer bootstrap baseline',
  icons: {
    // iOS Home Screen reads its icon from this link rather than from the
    // manifest, so the Apple icon is declared here even though the
    // manifest already lists the Android ones (Issue #304).
    apple: appleTouchIcon === undefined ? [] : [{ url: appleTouchIcon.path }],
  },
  appleWebApp: {
    // Emits `apple-mobile-web-app-capable`, which is what actually makes
    // an iOS Home Screen launch open standalone instead of in a Safari
    // tab.
    capable: true,
    title: PWA_NAME,
    // Not `black-translucent`: that mode extends the page under the status
    // bar, and the app bar (src/ui/AppBar.module.css) has no
    // safe-area-inset-top padding to survive it. `default` keeps the
    // status bar out of the layout, so standalone needs no layout change.
    statusBarStyle: 'default',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Colours the Android status bar and task-switcher chrome in standalone
  // mode. Deliberately no `maximumScale`/`userScalable`: pinch-zoom stays
  // available.
  //
  // `viewportFit` is left at its default rather than set to `cover` for
  // the same reason statusBarStyle is `default` above - drawing into the
  // display cutout/home-indicator area would need safe-area insets this
  // shell does not have yet.
  themeColor: PWA_THEME_COLOR,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
