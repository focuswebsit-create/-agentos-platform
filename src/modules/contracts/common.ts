import { z } from "zod";

/** UUID identifiers everywhere (DATA_MODEL.md). */
export const IdSchema = z.uuid();
export type Id = z.infer<typeof IdSchema>;

/** UTC ISO-8601 timestamp string. */
export const TimestampSchema = z.iso.datetime({ offset: true });

/** ISO 4217 currency codes supported in P0 display. */
export const CurrencySchema = z.enum(["ILS", "USD"]);
export type Currency = z.infer<typeof CurrencySchema>;

/**
 * Money is always integer minor units (agorot / cents) — never floating point.
 * See DATA_MODEL.md "financial values as integer minor units".
 */
export const MoneySchema = z.object({
  amountMinor: z.number().int().nonnegative(),
  currency: CurrencySchema,
});
export type Money = z.infer<typeof MoneySchema>;

export const LocaleSchema = z.enum(["he", "en"]);
export type Locale = z.infer<typeof LocaleSchema>;
