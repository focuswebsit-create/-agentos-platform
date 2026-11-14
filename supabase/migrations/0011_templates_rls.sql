-- =============================================================================
-- 0011_templates_rls.sql — privileges and policies for the template catalog
--
-- NOT APPLIED. Owner approval required before this reaches any Supabase project.
--
-- ROADMAP.md's P2 gate includes "unauthorized template editing denied". That is
-- delivered here by granting no write privilege at all on the two platform
-- tables, rather than by a policy that denies writes: a missing privilege
-- cannot be re-enabled by adding a policy later without someone also writing
-- the GRANT, and the GRANT is the line a reviewer will notice.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- global_templates — platform data, read-only to every customer
-- -----------------------------------------------------------------------------

alter table public.global_templates enable row level security;

revoke all on public.global_templates from anon, authenticated;

grant select on public.global_templates to authenticated;
grant select, insert, update on public.global_templates to service_role;

-- 'draft' templates are invisible, not merely unlisted. A template the platform
-- is still writing must not be discoverable by a customer who guesses a URL or
-- queries PostgREST directly.
--
-- 'retired' is also excluded: it is gone from the catalog. Organisations that
-- already installed it keep their copy, which is the whole point of installing
-- by copy rather than by reference.
create policy global_templates_select on public.global_templates
  for select to authenticated
  using (visibility = 'public');

-- No INSERT, UPDATE or DELETE policy, matching the withheld privileges. The
-- platform writes these through the service role, which carries BYPASSRLS and
-- the grants above.

-- -----------------------------------------------------------------------------
-- global_template_versions — likewise
-- -----------------------------------------------------------------------------

alter table public.global_template_versions enable row level security;

revoke all on public.global_template_versions from anon, authenticated;

grant select on public.global_template_versions to authenticated;
grant select, insert, update on public.global_template_versions to service_role;

-- Two conditions, both necessary. Published, because an unpublished version is
-- work in progress; and belonging to a public template, because otherwise a
-- published version of a draft template would be readable through this table
-- even though the template itself is hidden — a side door around the policy
-- above.
create policy global_template_versions_select on public.global_template_versions
  for select to authenticated
  using (
    published_at is not null
    and exists (
      select 1 from public.global_templates t
      where t.id = template_id and t.visibility = 'public'
    )
  );

-- -----------------------------------------------------------------------------
-- template_installations — ordinary tenant data
-- -----------------------------------------------------------------------------

alter table public.template_installations enable row level security;

revoke all on public.template_installations from anon, authenticated;

grant select on public.template_installations to authenticated;

-- No INSERT: install_template() in 0012 creates the installation, the agent and
-- its draft in one transaction. An installation row written on its own would
-- claim an agent came from a template that was never copied.
--
-- No UPDATE and no DELETE: this is the record of where an agent came from.

create policy template_installations_select on public.template_installations
  for select to authenticated
  using (public.is_org_member(org_id));
