import type { Locale, Money } from "@/modules/contracts";

const LOCALE_TAG: Record<Locale, string> = { he: "he-IL", en: "en-US" };

/** Formats integer minor units for display. Display only — never used for charging. */
export function formatMoney(money: Money, locale: Locale): string {
  const major = money.amountMinor / 100;
  return new Intl.NumberFormat(LOCALE_TAG[locale], {
    style: "currency",
    currency: money.currency,
    minimumFractionDigits: Number.isInteger(major) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(major);
}

export function formatUsdCents(cents: number, locale: Locale): string {
  return formatMoney({ amountMinor: cents, currency: "USD" }, locale);
}
