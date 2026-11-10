# UI/UX specification — bilingual generic SaaS

## Design system
Brand: AgentOS. Clean premium design, avoid overpowering neon. Default light or dark user preference saved in profile; Hebrew RTL first, English LTR. Accent violet/indigo, readable contrast, persistent navigation. Modern desktop + usable mobile tables; no false data on dashboards.

## Marketing navigation
Home / Product / Templates / Pricing / Security / FAQ / Login / Get Started. Mobile sticky CTA; legal in footer. Clear differentiation between product features now versus roadmap. Plan cards have *AI usage budget*, entitlements, monthly vs annual toggle only when annual supported.

## Customer workspace sidebar
Dashboard; Agents; Teams; Workflows; Templates; Live Runs; Knowledge; Integrations; Approvals; Analytics; Usage & Billing; Team; Settings. Each screen includes empty state and CTA.

## Detailed pages
- Dashboard: current usage and estimated provider spend; recent runs; action-required approvals; suggested next template, alerts on quota.
- Agents: card/list with search, status, selected model, last run; New Agent wizard; version history + publish.
- Agent Studio: Name, role, prompt, model provider dropdown, tool grants, knowledge, output schema, max steps/spend, live test and visible token cost. Form validation in place; Save Draft and Publish separate.
- Template Library: use-case tags + 'works without external connection' filter; clone/install preview.
- Teams / Workflows: v0 ordered lanes connected visually; only supported step types. Each node shows assigned agent and runtime contract.
- Live Runs: status queue/running/waiting_approval/completed/failed/cancelled, step trace, actions, error reason, cost estimate, stop button.
- Approvals: exact recipient/action/payload diff, expiry, accept/reject, requiring confirmation for risky action.
- Billing: plan, seats, usage $ + ILS estimate, monthly allowance, invoice receipts, renew/cancel and method portal links.
- Settings: org/team members, permission matrix, default timezone, language, data retention request.

## Super Admin
See SUPER_ADMIN.md. Separate auth boundary and admin color accent; no support impersonation by default.

## Responsive checks
375px, 768px, 1440px; RTL flipped meaningfully (not icons that imply direction unless intended), no overflow; tables collapse to cards on mobile. Typography comfortable at 100% and 200% zoom. Keyboard tab order, labels, aria-live run status, reduced-motion support.

## Empty states that must be truthful
No agents yet → create agent; no runs yet → try sample; payment provider not configured → 'billing unavailable in this environment', never 'paid'; no models configured → disable Run and show setup error; mock/demo content clearly labeled and separated.
