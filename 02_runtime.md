# Claude Code prompt — P3 runtime

Read docs and merged code. Implement P3 only: actual configurable model provider, durable queued/running/completed/failed/cancelled run lifecycle; checkpointed LangGraph workflow; Inngest event dispatcher; step traces; cost usage events and atomic worst-case budget reservation; per-org rate limits + concurrency; idempotency and cancellation. Add deterministic fake provider ONLY for tests, never hidden in live UI. Test a real provider in non-production if credentials are supplied securely. Work in PR; show exact tests and STOP after P3.
