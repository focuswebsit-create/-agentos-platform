-- =============================================================================
-- 0022_knowledge.sql — organisation knowledge sources
--
-- NOT APPLIED. Owner approval required before this reaches any Supabase project.
-- Requires 0020 (the knowledge-base count is an entitlement).
--
-- WHAT
--
--   knowledge_bases      named collections, per organisation
--   knowledge_documents  one uploaded or pasted text/markdown document
--   knowledge_chunks     the document split for retrieval, with a full-text index
--
-- Text is stored in Postgres, not in object storage: v1 accepts plain text and
-- markdown only (no PDF parsing, no executable or HTML rendering), bounded at
-- 512 KB per document. Retrieval is Postgres full-text search - no embedding
-- provider, no extra data processor, no extra cost.
--
-- ISOLATION
--
-- Every row carries org_id; composite foreign keys keep a document inside its
-- knowledge base's organisation and a chunk inside its document's. RLS lets
-- members of the organisation read; writes go through two functions that
-- check the role and, for new knowledge bases, the plan's limit. Chunks are
-- never written directly by any customer role.
--
-- DATA IT CHANGES: none. New tables and functions only.
-- =============================================================================

create table public.knowledge_bases (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  name        text not null check (length(btrim(name)) between 2 and 120),
  description text check (description is null or length(description) <= 500),
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  constraint knowledge_bases_org_id_key unique (org_id, id)
);
create index knowledge_bases_org_idx on public.knowledge_bases (org_id, created_at desc);

create table public.knowledge_documents (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null,
  knowledge_base_id uuid not null,
  title             text not null check (length(btrim(title)) between 1 and 200),
  source_type       text not null check (source_type in ('upload', 'paste')),
  mime_type         text not null check (mime_type in ('text/plain', 'text/markdown')),
  byte_size         integer not null check (byte_size between 1 and 524288),
  content_sha256    bytea not null check (length(content_sha256) = 32),
  chunk_count       integer not null check (chunk_count between 1 and 1000),
  created_by        uuid references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  constraint knowledge_documents_kb_fk
    foreign key (org_id, knowledge_base_id)
    references public.knowledge_bases (org_id, id) on delete cascade,
  constraint knowledge_documents_org_id_key unique (org_id, id),
  -- The same file twice in one knowledge base is a mistake, not a feature.
  constraint knowledge_documents_dedupe unique (knowledge_base_id, content_sha256)
);
create index knowledge_documents_kb_idx
  on public.knowledge_documents (org_id, knowledge_base_id, created_at desc);

create table public.knowledge_chunks (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null,
  knowledge_base_id uuid not null,
  document_id       uuid not null,
  chunk_index       integer not null check (chunk_index >= 0),
  content           text not null check (length(content) between 1 and 4000),
  -- 'simple' configuration: no language-specific stemming, which Postgres does
  -- not ship for Hebrew; words match as written.
  tsv               tsvector generated always as (to_tsvector('simple', content)) stored,
  constraint knowledge_chunks_doc_fk
    foreign key (org_id, document_id)
    references public.knowledge_documents (org_id, id) on delete cascade,
  constraint knowledge_chunks_kb_fk
    foreign key (org_id, knowledge_base_id)
    references public.knowledge_bases (org_id, id) on delete cascade,
  constraint knowledge_chunks_doc_index_key unique (document_id, chunk_index)
);
create index knowledge_chunks_tsv_idx on public.knowledge_chunks using gin (tsv);
create index knowledge_chunks_org_kb_idx on public.knowledge_chunks (org_id, knowledge_base_id);

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------

alter table public.knowledge_bases enable row level security;
alter table public.knowledge_documents enable row level security;
alter table public.knowledge_chunks enable row level security;

revoke all on public.knowledge_bases, public.knowledge_documents, public.knowledge_chunks
  from anon, authenticated;
grant select on public.knowledge_bases, public.knowledge_documents, public.knowledge_chunks
  to authenticated;
-- Removing knowledge: owner and admin, through RLS (cascades to chunks).
grant delete on public.knowledge_bases, public.knowledge_documents to authenticated;
grant select on public.knowledge_bases, public.knowledge_documents, public.knowledge_chunks
  to service_role;

create policy knowledge_bases_read on public.knowledge_bases for select to authenticated
  using (public.is_org_member(org_id));
create policy knowledge_documents_read on public.knowledge_documents for select to authenticated
  using (public.is_org_member(org_id));
create policy knowledge_chunks_read on public.knowledge_chunks for select to authenticated
  using (public.is_org_member(org_id));

create policy knowledge_bases_delete on public.knowledge_bases for delete to authenticated
  using (public.has_org_role(org_id, array['owner', 'admin']::public.org_role[]));
create policy knowledge_documents_delete on public.knowledge_documents for delete to authenticated
  using (public.has_org_role(org_id, array['owner', 'admin']::public.org_role[]));

-- -----------------------------------------------------------------------------
-- writes
-- -----------------------------------------------------------------------------

create or replace function public.create_knowledge_base(
  p_org_id      uuid,
  p_name        text,
  p_description text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_limit bigint;
  v_count integer;
  v_id    uuid;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'insufficient_privilege';
  end if;
  if not public.has_org_role(p_org_id, array['owner', 'admin', 'member']::public.org_role[]) then
    raise exception 'ORG_ACCESS_DENIED' using errcode = 'insufficient_privilege';
  end if;

  -- Serialise against concurrent creations so two cannot both slip under the limit.
  perform 1 from public.organizations o where o.id = p_org_id for update;

  v_limit := (public.org_entitlements(p_org_id) ->> 'knowledgeBases')::bigint;
  if v_limit is not null then
    select count(*) into v_count from public.knowledge_bases kb where kb.org_id = p_org_id;
    if v_count >= v_limit then
      raise exception 'PLAN_FEATURE_UNAVAILABLE' using errcode = 'insufficient_resources',
        detail = 'knowledge base limit reached for this plan';
    end if;
  end if;

  insert into public.knowledge_bases (org_id, name, description, created_by)
  values (p_org_id, btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''), v_uid)
  returning id into v_id;

  perform public.log_audit(p_org_id, 'user', 'knowledge_base.created', 'knowledge_base', v_id,
                           '{}'::jsonb);
  return v_id;
end;
$$;

-- The document and all its chunks in one transaction: a half-indexed document
-- would answer some questions and silently miss others.
create or replace function public.add_knowledge_document(
  p_knowledge_base_id uuid,
  p_title             text,
  p_source_type       text,
  p_mime_type         text,
  p_byte_size         integer,
  p_content_sha256    bytea,
  p_chunks            text[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_org_id uuid;
  v_doc    uuid;
  v_n      integer := coalesce(array_length(p_chunks, 1), 0);
  i        integer;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'insufficient_privilege';
  end if;

  select kb.org_id into v_org_id from public.knowledge_bases kb where kb.id = p_knowledge_base_id;
  if v_org_id is null
     or not public.has_org_role(v_org_id, array['owner', 'admin', 'member']::public.org_role[]) then
    raise exception 'ORG_ACCESS_DENIED' using errcode = 'insufficient_privilege';
  end if;

  if v_n = 0 or v_n > 1000 then
    raise exception 'VALIDATION_FAILED' using errcode = 'invalid_parameter_value';
  end if;

  insert into public.knowledge_documents
    (org_id, knowledge_base_id, title, source_type, mime_type, byte_size, content_sha256,
     chunk_count, created_by)
  values
    (v_org_id, p_knowledge_base_id, btrim(p_title), p_source_type, p_mime_type, p_byte_size,
     p_content_sha256, v_n, v_uid)
  returning id into v_doc;

  for i in 1 .. v_n loop
    insert into public.knowledge_chunks (org_id, knowledge_base_id, document_id, chunk_index, content)
    values (v_org_id, p_knowledge_base_id, v_doc, i - 1, p_chunks[i]);
  end loop;

  perform public.log_audit(v_org_id, 'user', 'knowledge_document.added', 'knowledge_document', v_doc,
                           jsonb_build_object('knowledge_base_id', p_knowledge_base_id,
                                              'chunks', v_n, 'bytes', p_byte_size));
  return v_doc;
end;
$$;

revoke execute on function public.create_knowledge_base(uuid, text, text) from public, anon;
grant execute on function public.create_knowledge_base(uuid, text, text) to authenticated;
revoke execute on function public.add_knowledge_document(uuid, text, text, text, integer, bytea, text[])
  from public, anon;
grant execute on function public.add_knowledge_document(uuid, text, text, text, integer, bytea, text[])
  to authenticated;
