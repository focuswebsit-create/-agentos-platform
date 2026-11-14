import { z } from "zod";

/**
 * Validation shared by the browser forms and the server.
 *
 * The same schema runs in both places on purpose: the client copy gives
 * immediate, specific feedback, and the server copy is the one that decides.
 * Client-side validation is a convenience, never a control.
 */

export const EmailSchema = z
  .string()
  .trim()
  .min(3)
  .max(254)
  .email()
  // Stored lower-case everywhere, matching the CHECK constraint on
  // invitations.email, so an invitation to Alex@x.com matches alex@x.com.
  .transform((v) => v.toLowerCase());

/**
 * 10 characters minimum. bcrypt silently ignores anything past 72 bytes, so a
 * longer value would give a false sense of strength; it is rejected instead.
 * Strength beyond length is enforced by Supabase's own password policy, which
 * the owner configures in the dashboard (see docs/SUPABASE_SETUP.md).
 */
export const PasswordSchema = z.string().min(10).max(72);

export const DisplayNameSchema = z.string().trim().min(1).max(80);

export const SignUpSchema = z.object({
  email: EmailSchema,
  password: PasswordSchema,
  displayName: DisplayNameSchema,
});
export type SignUpInput = z.infer<typeof SignUpSchema>;

export const SignInSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1),
});
export type SignInInput = z.infer<typeof SignInSchema>;

export const ForgotPasswordSchema = z.object({ email: EmailSchema });

export const ResetPasswordSchema = z
  .object({ password: PasswordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, {
    path: ["confirm"],
    message: "passwords_do_not_match",
  });

/**
 * Organisation slug. Lower-case, URL-safe, 2-40 characters, no leading or
 * trailing hyphen — identical to the CHECK constraint in migration 0001, so a
 * value accepted here cannot be rejected by the database.
 */
export const OrgSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/);

export const OrgNameSchema = z.string().trim().min(2).max(120);

export const CreateOrgSchema = z.object({ name: OrgNameSchema, slug: OrgSlugSchema });
export type CreateOrgInput = z.infer<typeof CreateOrgSchema>;

/** Derives a usable slug from a free-text organisation name. */
export function slugifyOrgName(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    // Hebrew and other non-Latin names produce nothing usable, so the user is
    // asked to supply a slug rather than being handed a mangled one.
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return base;
}
