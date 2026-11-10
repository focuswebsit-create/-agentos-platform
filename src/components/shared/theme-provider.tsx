"use client";

import * as React from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";

/** Light is the default; the choice is stored in localStorage until profile prefs exist (P1). */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="light"
      enableSystem={false}
      disableTransitionOnChange
      storageKey="agentos-theme"
    >
      {children}
    </NextThemesProvider>
  );
}
