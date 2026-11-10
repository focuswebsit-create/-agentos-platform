# Marketing Website / Funnel specification

## Public routes
- `/` — hero, demo illustration, 3 value pillars, social proof placeholder until real, 3 use cases, how it works, CTA.
- `/features` — Agent Studio, Templates, Workflows, Live Runs, Knowledge, Security, Billing controls.
- `/templates` and `/templates/[slug]` — discover use cases by job-to-be-done and industry tags; no promise connector works if not active.
- `/pricing` — monthly tiers, exact limits, AI allowance explanation, VAT disclosure, supported payment methods, CTA, FAQ, cancellation policy.
- `/how-it-works` — four steps; short hosted demo / real product screenshots once available.
- `/security` — accurate controls only; never claim SOC 2/ISO certification without audit.
- `/faq`, `/contact`, `/privacy`, `/terms`, `/cookies`, `/login`, `/signup`.
- `/status` optional simple trust page later.

## Above-fold suggested Hebrew copy
H1: **הצוות הדיגיטלי שלך. בנוי לעסק שלך.**
Subtitle: **צור סוכני AI, חבר אותם למשימות ותהליכים, ושלוט בתוצאות, בהרשאות ובהוצאות — ממקום אחד.**
Primary CTA: **התחילו להתנסות**
Secondary CTA: **צפו בהדגמה**
Microcopy: **לא צריך לדעת לתכנת. השליטה נשארת אצלכם.**
No claim of 'employees' replacing people or guaranteed business returns.

## Template positioning
Discovery tags: Marketing / Sales support / Customer support / Research / Operations / Docs. Templates must communicate prerequisites: e.g. 'outbound email requires verified connection and user approval'. 'Without integration' templates can run immediately with user text or uploaded sample data.

## Conversion funnel + analytics
UTM landing → pricing viewed → CTA click → signup started/completed → org created → template selected → run completed → trial started → payment started/completed. No PII/prompt text in external analytics. Cookie/marketing tracking consent where required. Show real testimonials only with permission.

## Onboarding wizard (5 steps)
1. Organization/company name and role.
2. Choose goal (content, documents, customer responses, research, other).
3. Choose template or blank agent; explain which integrations needed.
4. Run test with synthetic sample; show status, trace and result.
5. Invite teammate (optional) / plan upgrade based on entitlements.
Success = user gets a useful first result within 10 minutes. Track failure and help contextually.

## Design requirements
Premium light+dark themes (user preference), accessible contrast, RTL/English LTR, mobile with proper drawer and no horizontal overflow, skeletons, keyboard navigation, accessible form validation and price readability. Public SEO metadata and structured data only if accurate. Landing performance/core web vitals monitored; avoid expensive decorative animations for mobile.
