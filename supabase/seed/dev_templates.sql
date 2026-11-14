-- =============================================================================
-- dev_templates.sql — DEVELOPMENT SEED. Not a migration, and not production data.
--
-- CLAUDE.md rule 11: "migrations/seed only for development". This file lives
-- outside supabase/migrations/ on purpose, so nothing that applies migrations
-- can apply it by accident.
--
-- The four templates below are the ones PRD.md section 3 names. They are
-- STARTING POINTS, not tested products: the instructions are plausible first
-- drafts, every model id is an internal picker key from
-- src/modules/agent-engine/model-registry.ts rather than a real provider model,
-- and no provider is connected, so installing one produces an agent that can be
-- edited and published but not run.
--
-- The real catalog is platform content. It is published through Super Admin in
-- P6, or by an explicit owner-run step before then — never by this file.
--
-- Idempotent: safe to re-run against a development database.
-- =============================================================================

begin;

-- The four starting points, defined once and used by all three statements below.
create temporary table seed_templates (
  slug        text primary key,
  category    text not null,
  name        text not null,
  description text not null,
  definition  jsonb not null
) on commit drop;

insert into seed_templates (slug, category, name, description, definition) values
    (
      'support-triage',
      'support',
      'מענה ראשוני ללקוחות',
      'קולט פנייה בעברית, מסווג אותה ומציע תשובה. שליחה חיצונית דורשת אישור אנושי.',
      jsonb_build_object(
        'role', 'נציג תמיכה',
        'instructions',
          'ענה בעברית, בקצרה ובנימוס. סווג כל פנייה לאחת מהקטגוריות: טכני, חיוב, כללי. ' ||
          'אם חסר לך מידע, אמור זאת במפורש והפנה לנציג אנושי. ' ||
          'אל תמציא מדיניות החזרות, מחירים או מועדי אספקה שלא נמסרו לך.',
        'provider', 'anthropic',
        'model', 'claude-sonnet-5-5',
        'tools', '[]'::jsonb,
        'knowledgeBaseIds', '[]'::jsonb,
        'maxSteps', 6,
        'maxSpendUsdMicros', 500000
      )
    ),
    (
      'content-writer',
      'marketing',
      'כתיבת תוכן שיווקי',
      'מקבל בריף קצר ומחזיר טיוטה מובנית. מתאים לפוסטים, עמודי נחיתה וניוזלטר.',
      jsonb_build_object(
        'role', 'כותב תוכן',
        'instructions',
          'קבל בריף וכתוב טיוטה בעברית תקנית. פתח בכותרת, המשך בשלוש פסקאות קצרות וסיים בקריאה לפעולה. ' ||
          'אל תבטיח תוצאות מספריות ואל תשתמש בסופרלטיבים שאי אפשר לגבות. ' ||
          'אם הבריף חסר קהל יעד או מטרה, בקש אותם לפני הכתיבה.',
        'provider', 'anthropic',
        'model', 'claude-sonnet-5-5',
        'tools', '[]'::jsonb,
        'knowledgeBaseIds', '[]'::jsonb,
        'maxSteps', 8,
        'maxSpendUsdMicros', 1000000
      )
    ),
    (
      'document-qa',
      'knowledge',
      'שאלות ותשובות על מסמכים',
      'עונה על שאלות לפי מסמכים שהועלו, עם ציון הקטע שממנו נלקחה התשובה.',
      jsonb_build_object(
        'role', 'עוזר מחקר',
        'instructions',
          'ענה אך ורק על סמך המסמכים שסופקו לך. ציין לצד כל טענה את המסמך והקטע שממנו היא נלקחה. ' ||
          'אם התשובה אינה נמצאת במסמכים, אמור "לא מצאתי את זה במסמכים" ואל תשלים מידע מהידע הכללי שלך.',
        'provider', 'anthropic',
        'model', 'claude-sonnet-5-5',
        'tools', '[]'::jsonb,
        'knowledgeBaseIds', '[]'::jsonb,
        'maxSteps', 10,
        'maxSpendUsdMicros', 1500000
      )
    ),
    (
      'meeting-summary',
      'operations',
      'סיכום פגישה ומשימות',
      'הופך תמלול או הערות גולמיות לסיכום קצר ורשימת משימות עם אחראים.',
      jsonb_build_object(
        'role', 'מסכם פגישות',
        'instructions',
          'קבל תמלול או הערות וכתוב סיכום של עד עשר שורות, ואחריו רשימת משימות. ' ||
          'לכל משימה ציין אחראי ומועד אם נאמרו, ואם לא נאמרו כתוב "לא נקבע" במקום לנחש. ' ||
          'אל תייחס אמירה למי שלא אמר אותה.',
        'provider', 'anthropic',
        'model', 'claude-haiku-5-5',
        'tools', '[]'::jsonb,
        'knowledgeBaseIds', '[]'::jsonb,
        'maxSteps', 5,
        'maxSpendUsdMicros', 300000
      )
    );

-- Three statements, not one WITH chain. The sub-statements of a WITH clause all
-- share one snapshot and cannot see each other's effects on a target table, so
-- a single statement that inserted the templates and then set their
-- active_version_id would leave every NEW template pointing at nothing — while
-- appearing to work on the second run, once the rows already existed.

insert into public.global_templates (slug, category, name, description, visibility)
select slug, category, name, description, 'public'::public.template_visibility
from seed_templates
on conflict (slug) do update
  set category = excluded.category,
      name = excluded.name,
      description = excluded.description;

-- Version 1 only, and only where the template has none yet. A published version
-- is immutable (the trigger in 0012 enforces it), so re-running must never try
-- to rewrite one.
insert into public.global_template_versions (template_id, version, definition_json, published_at)
select t.id, 1, s.definition, now()
from public.global_templates t
join seed_templates s on s.slug = t.slug
where not exists (
  select 1 from public.global_template_versions v where v.template_id = t.id
);

update public.global_templates t
set active_version_id = v.id
from public.global_template_versions v
where v.template_id = t.id
  and v.version = 1
  and t.slug in (select slug from seed_templates)
  and t.active_version_id is distinct from v.id;

commit;

-- Re-running is a no-op for existing rows, so this reports the catalog as it
-- now stands rather than what this run happened to change.
select t.slug, t.visibility, v.version, t.active_version_id is not null as has_active
from public.global_templates t
left join public.global_template_versions v on v.id = t.active_version_id
order by t.slug;
