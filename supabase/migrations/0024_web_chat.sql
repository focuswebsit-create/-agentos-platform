-- =============================================================================
-- 0024_web_chat.sql — a public Web Chat channel for a published agent
--
-- NOT APPLIED. Owner approval required before this reaches any Supabase project.
-- Requires 0020 (entitlements) and 0023 (settlement period helper is not
-- needed here, but 0023 must precede so settle_run is the corrected one).
--
-- THE THREAT MODEL, AND WHAT ANSWERS IT
--
-- A chat widget is the first surface anyone on the internet can reach without
-- an account, and every message it accepts can cost the tenant money.
--
--   * Off by default. A widget is created disabled; an owner/admin enables it.
--   * Embedding is limited to the tenant's own sites: the hosted chat page
--     sends CSP `frame-ancestors` from allowed_origins (browser-enforced). An
--     empty list means the page cannot be embedded anywhere.
--   * Conversations are bound to a visitor token. Only its SHA-256 is stored;
--     reading or posting requires the token.
--   * Rate limits, counted here under a row lock so concurrent requests cannot
--     slip past them: messages per widget per day, visitor messages per
--     conversation, and new conversations per IP hash per hour.
--   * Every AI reply is an ordinary run: same entitlements, monthly cap,
--     concurrency limit, budget reservation and settlement as any other.
--   * Handoff: when a person takes over, visitor messages are stored but no
--     run is dispatched.
--
-- All public writes go through service_role functions called by the server;
-- no anonymous database role is granted anything.
--
-- DATA IT CHANGES: none. New tables and functions only.
-- =============================================================================

create table public.chat_widgets (
  id                      uuid primary key default gen_random_uuid(),
  org_id                  uuid not null references public.organizations (id) on delete cascade,
  agent_id                uuid not null,
  -- Public identifier embedded in the customer's site. Not a secret.
  public_key              text not null unique check (public_key ~ '^wk_[A-Za-z0-9_-]{20,64}$'),
  enabled                 boolean not null default false,
  allowed_origins         text[] not null default '{}'
                          check (array_length(allowed_origins, 1) is null or array_length(allowed_origins, 1) <= 10),
  daily_message_limit     integer not null default 200 check (daily_message_limit between 1 and 5000),
  conversation_message_limit integer not null default 30 check (conversation_message_limit between 1 and 200),
  greeting                text check (greeting is null or length(greeting) <= 300),
  created_by              uuid references auth.users (id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint chat_widgets_agent_fk foreign key (org_id, agent_id)
    references public.agents (org_id, id) on delete cascade,
  constraint chat_widgets_org_id_key unique (org_id, id)
);

create table public.conversations (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null,
  widget_id          uuid not null,
  visitor_token_hash bytea not null unique check (length(visitor_token_hash) = 32),
  -- SHA-256 of the client IP with a server-side salt; never the IP itself.
  ip_hash            bytea check (ip_hash is null or length(ip_hash) = 32),
  status             text not null default 'open' check (status in ('open', 'handoff', 'closed')),
  created_at         timestamptz not null default now(),
  last_message_at    timestamptz not null default now(),
  constraint conversations_widget_fk foreign key (org_id, widget_id)
    references public.chat_widgets (org_id, id) on delete cascade,
  constraint conversations_org_id_key unique (org_id, id)
);
create index conversations_org_last_idx on public.conversations (org_id, last_message_at desc);
create index conversations_ip_created_idx on public.conversations (ip_hash, created_at);

create table public.conversation_messages (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null,
  conversation_id uuid not null,
  role            text not null check (role in ('visitor', 'agent', 'human', 'system')),
  content         text not null check (length(content) between 1 and 4000),
  run_id          uuid,
  author_user_id  uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  constraint conversation_messages_conv_fk foreign key (org_id, conversation_id)
    references public.conversations (org_id, id) on delete cascade,
  constraint conversation_messages_run_fk foreign key (org_id, run_id)
    references public.runs (org_id, id) on delete set null (run_id)
);
create index conversation_messages_conv_idx
  on public.conversation_messages (conversation_id, created_at);

-- -----------------------------------------------------------------------------
-- RLS: the tenant reads its own; owners/admins manage widgets; nobody else.
-- -----------------------------------------------------------------------------
alter table public.chat_widgets enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_messages enable row level security;

revoke all on public.chat_widgets, public.conversations, public.conversation_messages
  from anon, authenticated;
grant select on public.chat_widgets, public.conversations, public.conversation_messages
  to authenticated;
grant update (enabled, allowed_origins, daily_message_limit, conversation_message_limit, greeting, updated_at)
  on public.chat_widgets to authenticated;
grant select, insert, update on public.chat_widgets, public.conversations, public.conversation_messages
  to service_role;

create policy chat_widgets_read on public.chat_widgets for select to authenticated
  using (public.is_org_member(org_id));
create policy chat_widgets_update on public.chat_widgets for update to authenticated
  using (public.has_org_role(org_id, array['owner', 'admin']::public.org_role[]))
  with check (public.has_org_role(org_id, array['owner', 'admin']::public.org_role[]));
create policy conversations_read on public.conversations for select to authenticated
  using (public.is_org_member(org_id));
create policy conversation_messages_read on public.conversation_messages for select to authenticated
  using (public.is_org_member(org_id));

-- -----------------------------------------------------------------------------
-- customer-side functions (authenticated)
-- -----------------------------------------------------------------------------

create or replace function public.create_chat_widget(p_agent_id uuid, p_public_key text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_id  uuid;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'insufficient_privilege';
  end if;
  select a.org_id into v_org from public.agents a where a.id = p_agent_id;
  if v_org is null or not public.has_org_role(v_org, array['owner', 'admin']::public.org_role[]) then
    raise exception 'ORG_ACCESS_DENIED' using errcode = 'insufficient_privilege';
  end if;
  insert into public.chat_widgets (org_id, agent_id, public_key, created_by)
  values (v_org, p_agent_id, p_public_key, v_uid)
  returning id into v_id;
  perform public.log_audit(v_org, 'user', 'chat_widget.created', 'chat_widget', v_id, '{}'::jsonb);
  return v_id;
end;
$$;

-- Take over (handoff), give back to the agent, or close.
create or replace function public.set_conversation_status(p_conversation_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'insufficient_privilege';
  end if;
  if p_status not in ('open', 'handoff', 'closed') then
    raise exception 'VALIDATION_FAILED' using errcode = 'invalid_parameter_value';
  end if;
  select c.org_id into v_org from public.conversations c where c.id = p_conversation_id;
  if v_org is null or not public.has_org_role(v_org, array['owner', 'admin', 'member']::public.org_role[]) then
    raise exception 'ORG_ACCESS_DENIED' using errcode = 'insufficient_privilege';
  end if;
  update public.conversations set status = p_status where id = p_conversation_id;
  perform public.log_audit(v_org, 'user', 'conversation.status', 'conversation', p_conversation_id,
                           jsonb_build_object('status', p_status));
end;
$$;

-- A person replies in a conversation they have taken over.
create or replace function public.post_human_reply(p_conversation_id uuid, p_content text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_status text;
  v_id  uuid;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'insufficient_privilege';
  end if;
  select c.org_id, c.status into v_org, v_status from public.conversations c where c.id = p_conversation_id;
  if v_org is null or not public.has_org_role(v_org, array['owner', 'admin', 'member']::public.org_role[]) then
    raise exception 'ORG_ACCESS_DENIED' using errcode = 'insufficient_privilege';
  end if;
  if v_status <> 'handoff' then
    raise exception 'VALIDATION_FAILED' using errcode = 'invalid_parameter_value',
      detail = 'take over the conversation before replying';
  end if;
  insert into public.conversation_messages (org_id, conversation_id, role, content, author_user_id)
  values (v_org, p_conversation_id, 'human', btrim(p_content), v_uid)
  returning id into v_id;
  update public.conversations set last_message_at = now() where id = p_conversation_id;
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- public-side functions (service_role only, called by the server)
-- -----------------------------------------------------------------------------

-- Opens a conversation for an ENABLED widget, enforcing the per-IP hourly limit.
create or replace function public.open_conversation(
  p_public_key text, p_token_hash bytea, p_ip_hash bytea
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_widget record;
  v_recent integer;
  v_id     uuid;
begin
  select w.id, w.org_id, w.enabled into v_widget
  from public.chat_widgets w where w.public_key = p_public_key;
  if v_widget.id is null or not v_widget.enabled then
    raise exception 'WIDGET_NOT_AVAILABLE' using errcode = 'no_data_found';
  end if;

  perform 1 from public.chat_widgets w where w.id = v_widget.id for update;
  if p_ip_hash is not null then
    select count(*) into v_recent from public.conversations c
    where c.ip_hash = p_ip_hash and c.created_at > now() - interval '1 hour';
    if v_recent >= 5 then
      raise exception 'RATE_LIMITED' using errcode = 'insufficient_resources';
    end if;
  end if;

  insert into public.conversations (org_id, widget_id, visitor_token_hash, ip_hash)
  values (v_widget.org_id, v_widget.id, p_token_hash, p_ip_hash)
  returning id into v_id;
  return jsonb_build_object('conversation_id', v_id);
end;
$$;

-- Records a visitor message and, unless a person has taken over, dispatches a
-- run of the agent's PUBLISHED version with every start_run limit applied.
create or replace function public.post_visitor_message(
  p_public_key text, p_token_hash bytea, p_content text, p_prompt jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_widget    record;
  v_conv      record;
  v_count     integer;
  v_msg       uuid;
  v_version   uuid;
  v_status    public.agent_status;
  v_org_state public.org_status;
  v_ent       jsonb;
  v_live      integer;
  v_budget    bigint;
  v_cap       bigint;
  v_period    date := public.current_usage_period();
  v_spent     bigint;
  v_reserved  bigint;
  v_run_id    uuid;
begin
  select w.* into v_widget from public.chat_widgets w where w.public_key = p_public_key;
  if v_widget.id is null or not v_widget.enabled then
    raise exception 'WIDGET_NOT_AVAILABLE' using errcode = 'no_data_found';
  end if;

  select c.id, c.status into v_conv from public.conversations c
  where c.visitor_token_hash = p_token_hash and c.widget_id = v_widget.id;
  if v_conv.id is null then
    raise exception 'CONVERSATION_NOT_FOUND' using errcode = 'no_data_found';
  end if;
  if v_conv.status = 'closed' then
    raise exception 'CONVERSATION_CLOSED' using errcode = 'invalid_parameter_value';
  end if;

  -- Serialise this tenant: limits, budget and dispatch are read under the lock.
  perform 1 from public.organizations o where o.id = v_widget.org_id for update;

  select count(*) into v_count from public.conversation_messages m
  where m.conversation_id = v_conv.id and m.role = 'visitor';
  if v_count >= v_widget.conversation_message_limit then
    raise exception 'RATE_LIMITED' using errcode = 'insufficient_resources';
  end if;
  select count(*) into v_count from public.conversation_messages m
  join public.conversations c on c.id = m.conversation_id
  where c.widget_id = v_widget.id and m.role = 'visitor'
    and m.created_at > date_trunc('day', now());
  if v_count >= v_widget.daily_message_limit then
    raise exception 'RATE_LIMITED' using errcode = 'insufficient_resources';
  end if;

  insert into public.conversation_messages (org_id, conversation_id, role, content)
  values (v_widget.org_id, v_conv.id, 'visitor', btrim(p_content))
  returning id into v_msg;
  update public.conversations set last_message_at = now() where id = v_conv.id;

  if v_conv.status = 'handoff' then
    return jsonb_build_object('message_id', v_msg, 'run_id', null, 'handoff', true);
  end if;

  select a.status, a.active_version_id into v_status, v_version
  from public.agents a where a.id = v_widget.agent_id;
  if v_status = 'archived' or v_version is null then
    raise exception 'AGENT_VERSION_MISSING' using errcode = 'no_data_found';
  end if;

  select o.status into v_org_state from public.organizations o where o.id = v_widget.org_id;
  if v_org_state = 'suspended' then
    raise exception 'ORG_SUSPENDED' using errcode = 'insufficient_privilege';
  end if;

  v_ent := public.org_entitlements(v_widget.org_id);
  if not coalesce((v_ent ->> 'runsAllowed')::boolean, false) then
    raise exception 'SUBSCRIPTION_INACTIVE' using errcode = 'insufficient_privilege';
  end if;
  if (v_ent ->> 'maxConcurrentRuns') is not null then
    select count(*) into v_live from public.runs r
    where r.org_id = v_widget.org_id and r.status in ('queued', 'running', 'awaiting_approval');
    if v_live >= (v_ent ->> 'maxConcurrentRuns')::integer then
      raise exception 'RUN_CONCURRENCY_LIMIT' using errcode = 'insufficient_resources';
    end if;
  end if;
  v_cap := (v_ent ->> 'monthlyModelBudgetUsdMicros')::bigint;

  select (v.config_json ->> 'maxSpendUsdMicros')::bigint into v_budget
  from public.agent_versions v where v.id = v_version;
  if v_budget is null or v_budget <= 0 then
    raise exception 'AGENT_CONFIG_INVALID' using errcode = 'invalid_parameter_value';
  end if;

  insert into public.usage_periods (org_id, period_start) values (v_widget.org_id, v_period)
  on conflict (org_id, period_start) do nothing;
  select p.spent_usd_micros, p.reserved_usd_micros into v_spent, v_reserved
  from public.usage_periods p where p.org_id = v_widget.org_id and p.period_start = v_period;
  if v_spent + v_reserved + v_budget > v_cap then
    raise exception 'USAGE_LIMIT_REACHED' using errcode = 'insufficient_resources';
  end if;

  insert into public.runs (org_id, agent_id, agent_version_id, initiator_user_id, input_json, budget_usd_micros)
  values (v_widget.org_id, v_widget.agent_id, v_version, null, coalesce(p_prompt, '{}'::jsonb), v_budget)
  returning id into v_run_id;
  insert into public.usage_reservations (org_id, run_id, max_usd_micros, expires_at)
  values (v_widget.org_id, v_run_id, v_budget, now() + interval '1 hour');
  update public.usage_periods
  set reserved_usd_micros = reserved_usd_micros + v_budget, updated_at = now()
  where org_id = v_widget.org_id and period_start = v_period;

  return jsonb_build_object('message_id', v_msg, 'run_id', v_run_id, 'handoff', false,
                            'conversation_id', v_conv.id, 'org_id', v_widget.org_id);
end;
$$;

revoke execute on function public.create_chat_widget(uuid, text) from public, anon;
grant execute on function public.create_chat_widget(uuid, text) to authenticated;
revoke execute on function public.set_conversation_status(uuid, text) from public, anon;
grant execute on function public.set_conversation_status(uuid, text) to authenticated;
revoke execute on function public.post_human_reply(uuid, text) from public, anon;
grant execute on function public.post_human_reply(uuid, text) to authenticated;
revoke execute on function public.open_conversation(text, bytea, bytea) from public, anon, authenticated;
grant execute on function public.open_conversation(text, bytea, bytea) to service_role;
revoke execute on function public.post_visitor_message(text, bytea, text, jsonb) from public, anon, authenticated;
grant execute on function public.post_visitor_message(text, bytea, text, jsonb) to service_role;
