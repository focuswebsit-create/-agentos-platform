import { describe, expect, it } from "vitest";
import { DEFAULT_LOCALE, getDictionary, getDirection, interpolate } from "@/i18n";

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

/** Structural signature: keys + array lengths, ignoring string values. */
function shape(value: unknown): Json {
  if (Array.isArray(value)) return value.map(shape);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, shape(v)]),
    );
  }
  return typeof value;
}

function leaves(value: unknown, path = ""): [string, unknown][] {
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => leaves(v, `${path}.${k}`));
  }
  return [[path, value]];
}

describe("i18n", () => {
  it("defaults to Hebrew RTL", () => {
    expect(DEFAULT_LOCALE).toBe("he");
    expect(getDirection("he")).toBe("rtl");
    expect(getDirection("en")).toBe("ltr");
  });

  it("Hebrew and English dictionaries have identical structure", () => {
    expect(shape(getDictionary("en"))).toEqual(shape(getDictionary("he")));
  });

  it("has no empty strings", () => {
    for (const locale of ["he", "en"] as const) {
      for (const [path, v] of leaves(getDictionary(locale))) {
        expect(typeof v === "string" && v.trim().length > 0, `${locale}${path}`).toBe(true);
      }
    }
  });

  it("uses the same interpolation variables in both locales", () => {
    const vars = (s: unknown) => (typeof s === "string" ? (s.match(/\{\w+\}/g) ?? []).sort() : []);
    const en = new Map(leaves(getDictionary("en")));
    for (const [path, v] of leaves(getDictionary("he"))) {
      expect(vars(en.get(path)), path).toEqual(vars(v));
    }
  });

  it("interpolates known variables and leaves unknown ones", () => {
    expect(interpolate("{n} agents in {phase}", { n: 3 })).toBe("3 agents in {phase}");
  });

  it("never claims billing is active", () => {
    const all = leaves(getDictionary("he"))
      .map(([, v]) => String(v))
      .join("\n");
    expect(all).not.toMatch(/הסליקה פעילה|סליקה פעילה כעת|המנוי שלך פעיל/);
    const allEn = leaves(getDictionary("en"))
      .map(([, v]) => String(v))
      .join("\n");
    expect(allEn).not.toMatch(/billing is active|buy now|subscription is active/i);
  });
});
