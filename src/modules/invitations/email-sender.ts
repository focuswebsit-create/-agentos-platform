/**
 * Outbound email, as an adapter.
 *
 * P1 ships NO working sender. Supabase's built-in mailer only sends its own
 * auth emails and cannot deliver an organisation invitation, so an invitation
 * email needs a provider — a commercial decision that is deliberately not
 * being made inside this phase.
 *
 * Rather than pretend, invitations work by giving the inviter a link to copy.
 * The whole mechanism — token, hash, expiry, single use, seat accounting — is
 * real and tested; only delivery is manual, and the UI says so plainly
 * (CLAUDE.md rule 4: no integration described as operational unless it is).
 *
 * Adding Resend, Postmark or SES later means implementing this one interface.
 */

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
};

export type SendResult =
  { delivered: true; provider: string } | { delivered: false; reason: "no_provider_configured" };

export interface EmailSender {
  readonly name: string;
  send(message: EmailMessage): Promise<SendResult>;
}

/**
 * The only sender wired up in P1. It reports honestly that nothing was sent,
 * so no caller can mistake a queued message for a delivered one.
 */
export const noopEmailSender: EmailSender = {
  name: "none",
  async send(): Promise<SendResult> {
    return { delivered: false, reason: "no_provider_configured" };
  },
};

export function getEmailSender(): EmailSender {
  return noopEmailSender;
}

export function isAutomaticEmailEnabled(): boolean {
  return getEmailSender().name !== "none";
}
