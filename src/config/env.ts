import { z } from "zod";

/**
 * Server-side environment parsing. Only non-secret flags exist in P0.
 * Never add secrets with a NEXT_PUBLIC_ prefix.
 */
const ServerEnvSchema = z.object({
  ADMIN_SHELL_PREVIEW: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
  NEXT_PUBLIC_SITE_URL: z.url().optional(),
});

export type ServerEnv = z.infer<typeof ServerEnvSchema>;

export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const result = ServerEnvSchema.safeParse({
    ADMIN_SHELL_PREVIEW: source.ADMIN_SHELL_PREVIEW || undefined,
    NEXT_PUBLIC_SITE_URL: source.NEXT_PUBLIC_SITE_URL || undefined,
  });
  // Fail closed: an invalid value never enables the admin shell.
  if (!result.success) return { ADMIN_SHELL_PREVIEW: false, NEXT_PUBLIC_SITE_URL: undefined };
  return result.data;
}

export function isAdminShellPreviewEnabled(
  source: Record<string, string | undefined> = process.env,
): boolean {
  return parseServerEnv(source).ADMIN_SHELL_PREVIEW;
}
