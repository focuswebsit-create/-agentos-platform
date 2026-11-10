# PostgreSQL data model — Commercial v1.0

UUID IDs, UTC timestamptz, financial values as integer minor units or fixed precision numeric; NEVER floating point for invoices. All tenant-owned tables have `org_id UUID NOT NULL`, indexes `(org_id,...)`, RLS AND backend tenant membership checks. Composite `(org_id,id)` keys/FKs where appropriate. Platform tables isolated from tenant access.

## Identity/tenancy
- `organizations(id, slug, name, locale, timezone, status, created_at)`
- `memberships(org_id,user_id,role,created_at, UNIQUE(org_id,user_id))`
- `invitations(id,org_id,email,role,token_hash,expires_at,status)`
- `platform_admins(user_id,role,mfa_required,active,created_at)` **not** org role.

## Agent + runtime
- `agents(id,org_id,name,status,active_version_id,created_by,created_at)`
- `agent_versions(id,org_id,agent_id,version,config_json,published_at,created_by, UNIQUE(agent_id,version))`
- `teams(id,org_id,name,status)` / `team_members(org_id,team_id,agent_id,step_order,role)`
- `workflows(id,org_id,name,active_version_id)` / `workflow_versions(id,org_id,workflow_id,version,definition_json,published_at)`
- `runs(id,org_id,initiator_id,version_ref,workflow_ref,status,input_ref,result_ref,idempotency_key,created_at,started_at,ended_at,budget_usd,reserved_usd,spent_usd)`
- `run_steps(id,org_id,run_id,step_index,agent_version_id,status,kind,provider,model,usage_usd,redacted_trace_ref,timestamps)`
- `conversations` / `messages`, `tool_definitions`, `agent_tool_grants`, `approval_requests`, `outbox_events`.
- `knowledge_bases`, `knowledge_documents`, `document_chunks(embedding,source_ref)` with filtered org/KB permissions in DB query.

## Templates (global vs installation)
- `global_templates(id, slug, category, visibility, active_version_id)` (platform-managed)
- `global_template_versions(id,template_id,version,definition_json,required_tools,published_at)` immutable
- `template_installations(id,org_id,template_version_id,installed_by,linked_workflow_id,created_at)`

## Billing and plan management
- `plans(id,code,public_label,active)`
- `plan_versions(id,plan_id,version,price_minor,currency,billing_interval,features_json,provider_price_id,published_at)` immutable
- `subscriptions(id,org_id,plan_version_id,provider,provider_customer_id,provider_subscription_id,status,trial_ends_at,current_period_start,current_period_end,cancel_at_period_end,scheduled_plan_version_id,updated_at)`
- `checkout_sessions(id,org_id,user_id,plan_version_id,provider,provider_session_id,status,idempotency_key,created_at)`
- `billing_webhook_events(id,provider,event_id,payload_digest,verified_at,processed_at,status, UNIQUE(provider,event_id))`
- `billing_invoices(id,org_id,provider,external_invoice_id,currency,total_minor,tax_minor,status,invoice_url,period_start,period_end)`
- `payments(id,org_id,invoice_id,provider,external_tx_id,currency,amount_minor,status,paid_at, UNIQUE(provider,external_tx_id))`
- `subscription_events(id,org_id,subscription_id,old_state,new_state,cause,created_at)`
- `entitlement_overrides(id,org_id,entitlement_key,value_json,reason,approved_by,expires_at,created_at)`

## Usage and operations
- `usage_events(id,org_id,run_id,step_id,provider,model,units_json,cost_usd,estimate_source,rate_card_version,created_at)` append only
- `usage_reservations(id,org_id,run_id,model,max_usd,status,expires_at,created_at)` unique active reservations per dispatch
- `usage_periods(org_id,subscription_id,period_start,period_end,spent_usd,reserved_usd,updated_at, UNIQUE(org_id,subscription_id,period_start))` transactional guard; optional materialization
- `audit_events(id,org_id nullable,actor_user_id,actor_type,action,entity_type,entity_id,metadata_redacted,created_at)` append-only
- `platform_incidents(id,severity,status,opened_at,resolved_at)`
- `feature_flags(key,default_value,created_at)`, `org_feature_flag_overrides(org_id,key,value,reason,expires_at)`

## Integrity requirements
- `subscriptions` authoritative by provider id, unique mappings, one effective primary active subscription per org unless migration state explicitly modeled.
- Org foreign-key containment: a run cannot reference a different org's agent/version; a team member cannot belong to another org; approval request cannot point to another org's run.
- Webhook event dedupe and payments uniqueness are enforced in DB.
- RLS never exposes platform_admin tables or other organizations' billing/usage data. Sensitive platform reporting executes via audited service method, not blanket RLS bypass exposed to clients.
- Published versions cannot be mutated in place; schema JSON validated and versioned.
- Provide indexes on `(org_id,status,created_at)` for runs and subs; partition usage if scale requires later.
