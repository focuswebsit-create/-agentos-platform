import type { Locale } from "@/modules/contracts";
import { en } from "./en";
import { he } from "./he";
import type { Dictionary } from "./types";

export type { Dictionary };

export const DEFAULT_LOCALE: Locale = "he";
export const SUPPORTED_LOCALES: readonly Locale[] = ["he", "en"];

const DICTIONARIES: Record<Locale, Dictionary> = { he, en };

export function getDictionary(locale: Locale = DEFAULT_LOCALE): Dictionary {
  return DICTIONARIES[locale];
}

export function getDirection(locale: Locale): "rtl" | "ltr" {
  return locale === "he" ? "rtl" : "ltr";
}

/** Minimal `{var}` interpolation. Unknown variables are left untouched. */
export function interpolate(template: string, vars: Readonly<Record<string, string | number>>) {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in vars ? String(vars[key]) : match,
  );
}
