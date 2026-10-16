-- ChatSOS · Phase 1 · read-only verification. Run after all 5 migrations.
-- A single SELECT: it changes nothing. Failing checks are listed first, and the
-- "== ALL CHECKS PASSED ==" row is true only when every check passed.
--
-- Not covered here (check by hand or in step 1D):
--   * Settings > Data API > Exposed schemas must NOT include "private".
--   * Real RLS behaviour and Realtime delivery are tested end to end in step 1D.

with
target_tables (table_name) as (
  values ('profiles'), ('conversations'), ('conversation_members'), ('messages')
),
target_roles (role_name) as (
  values ('anon'), ('authenticated')
),
-- The complete allowlist. Anything granted that is not listed here is reported
-- as UNEXPECTED; anything listed that is not granted is reported as MISSING.
-- column_name null = table-level grant (covers every column of the table).
allowed_privileges (role_name, table_name, privilege, column_name) as (
  values
    ('authenticated', 'profiles', 'SELECT', 'id'),
    ('authenticated', 'profiles', 'SELECT', 'username'),
    ('authenticated', 'profiles', 'SELECT', 'display_name'),
    ('authenticated', 'profiles', 'SELECT', 'avatar_path'),
    ('authenticated', 'profiles', 'UPDATE', 'display_name'),
    ('authenticated', 'profiles', 'UPDATE', 'avatar_path'),
    ('authenticated', 'conversations', 'SELECT', null),
    ('authenticated', 'conversation_members', 'SELECT', null),
    ('authenticated', 'conversation_members', 'UPDATE', 'last_read_at'),
    ('authenticated', 'messages', 'SELECT', null),
    ('authenticated', 'messages', 'INSERT', 'id'),
    ('authenticated', 'messages', 'INSERT', 'conversation_id'),
    ('authenticated', 'messages', 'INSERT', 'kind'),
    ('authenticated', 'messages', 'INSERT', 'content'),
    ('authenticated', 'messages', 'INSERT', 'attachment_path'),
    ('authenticated', 'messages', 'INSERT', 'attachment_name'),
    ('authenticated', 'messages', 'INSERT', 'attachment_size'),
    ('authenticated', 'messages', 'INSERT', 'attachment_mime')
),
-- Every table-level privilege, for every role and table.
table_privilege_matrix as (
  select
    r.role_name,
    t.table_name,
    p.privilege || ' (whole table)' as label,
    has_table_privilege(r.role_name, format('public.%I', t.table_name), p.privilege) as actual,
    exists (
      select 1
      from allowed_privileges ap
      where ap.role_name = r.role_name
        and ap.table_name = t.table_name
        and ap.privilege = p.privilege
        and ap.column_name is null
    ) as expected,
    false as implied_by_table_grant
  from target_roles r
  cross join target_tables t
  cross join (
    values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')
  ) as p (privilege)
),
-- Every column-level privilege, for every role, table and column.
column_privilege_matrix as (
  select
    r.role_name,
    t.table_name,
    p.privilege || '(' || a.attname || ')' as label,
    has_column_privilege(r.role_name, c.oid, a.attnum, p.privilege) as actual,
    exists (
      select 1
      from allowed_privileges ap
      where ap.role_name = r.role_name
        and ap.table_name = t.table_name
        and ap.privilege = p.privilege
        and (ap.column_name is null or ap.column_name = a.attname::text)
    ) as expected,
    has_table_privilege(r.role_name, c.oid, p.privilege) as implied_by_table_grant
  from target_roles r
  cross join target_tables t
  join pg_catalog.pg_class c on c.oid = to_regclass(format('public.%I', t.table_name))
  join pg_catalog.pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('REFERENCES')) as p (privilege)
),
privilege_matrix as (
  select * from table_privilege_matrix
  union all
  select * from column_privilege_matrix
),
expected_functions (signature, authenticated_can_execute) as (
  values
    ('public.handle_new_user()', false),
    ('public.create_direct_conversation(uuid)', true),
    ('public.create_group_conversation(text, uuid[])', true),
    ('private.is_member(uuid)', true),
    ('private.can_access_attachment(text)', true),
    ('private.validate_message_attachment()', false),
    ('private.touch_conversation()', false)
),
functions as (
  select e.signature, e.authenticated_can_execute, p.oid, p.prosecdef, p.proconfig, p.proacl
  from expected_functions e
  left join pg_catalog.pg_proc p on p.oid = to_regprocedure(e.signature)
),
-- Each policy with its exact USING and WITH CHECK expressions, verbatim as PostgreSQL
-- prints them in pg_policies (captured from the deployed schema, step 1B, 2026-10-16).
-- null means the policy has no such expression. Compared with IS NOT DISTINCT FROM and
-- no normalisation, so any edit (e.g. an added "OR true") fails the check.
-- The printed form depends on search_path: run this in the SQL Editor, where neither
-- auth nor private is on the path. A PostgreSQL upgrade may also change the printing.
-- If a policy check then fails, compare the detail column before touching the policy.
expected_policies (schema_name, table_name, policy_name, command, expected_using, expected_check) as (
  values
    ('public', 'profiles', 'profiles: signed-in users can read', 'SELECT',
      'true',
      null::text),
    ('public', 'profiles', 'profiles: users update their own', 'UPDATE',
      '(id = ( SELECT auth.uid() AS uid))',
      '(id = ( SELECT auth.uid() AS uid))'),
    ('public', 'conversations', 'conversations: members can read', 'SELECT',
      'private.is_member(id)',
      null::text),
    ('public', 'conversation_members', 'conversation_members: members can read the member list', 'SELECT',
      'private.is_member(conversation_id)',
      null::text),
    ('public', 'conversation_members', 'conversation_members: users update their own read marker', 'UPDATE',
      '(user_id = ( SELECT auth.uid() AS uid))',
      '(user_id = ( SELECT auth.uid() AS uid))'),
    ('public', 'messages', 'messages: members can read', 'SELECT',
      'private.is_member(conversation_id)',
      null::text),
    ('public', 'messages', 'messages: members send as themselves', 'INSERT',
      null::text,
      '((sender_id = ( SELECT auth.uid() AS uid)) AND private.is_member(conversation_id))'),
    ('storage', 'objects', 'attachments: members can read', 'SELECT',
      '((bucket_id = ''attachments''::text) AND private.can_access_attachment(name))',
      null::text),
    ('storage', 'objects', 'attachments: members can upload new files', 'INSERT',
      null::text,
      '((bucket_id = ''attachments''::text) AND (name ~ ''^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|gif|pdf|txt|zip|docx|xlsx|pptx)$''::text) AND private.can_access_attachment(name))')
),
expected_constraints (table_name, constraint_name) as (
  values
    ('profiles', 'profiles_username_format'),
    ('profiles', 'profiles_display_name_valid'),
    ('profiles', 'profiles_avatar_path_valid'),
    ('conversations', 'conversations_type_valid'),
    ('conversations', 'conversations_direct_key_format'),
    ('conversations', 'conversations_shape'),
    ('conversation_members', 'conversation_members_role_valid'),
    ('messages', 'messages_kind_valid'),
    ('messages', 'messages_content_length'),
    ('messages', 'messages_kind_consistency'),
    ('messages', 'messages_attachment_path_valid'),
    ('messages', 'messages_attachment_name_valid'),
    ('messages', 'messages_attachment_size_valid'),
    ('messages', 'messages_attachment_type_valid'),
    ('messages', 'messages_image_is_image')
),
expected_mime_types (mime) as (
  select unnest(array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'application/pdf',
    'text/plain',
    'application/zip',
    'application/x-zip-compressed',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ])
),
checks (name, ok, detail) as (
  -- RLS enabled on every table
  select
    'RLS enabled: public.' || t.table_name,
    coalesce((
      select c.relrowsecurity
      from pg_catalog.pg_class c
      where c.oid = to_regclass(format('public.%I', t.table_name))
    ), false),
    null::text
  from target_tables t

  union all
  -- Full privilege matrix vs. the allowlist, one row per role and table.
  -- detail lists every mismatch, or (when it matches) what is actually granted.
  select
    format('privileges match allowlist: %s on public.%s', m.role_name, m.table_name),
    bool_and(m.actual = m.expected),
    coalesce(
      string_agg(
        case
          when m.actual and not m.expected then 'UNEXPECTED ' || m.label
          when m.expected and not m.actual then 'MISSING ' || m.label
        end,
        '; ' order by m.label
      ),
      'granted: ' || coalesce(
        string_agg(m.label, ', ' order by m.label) filter (where m.actual and not m.implied_by_table_grant),
        'nothing'
      )
    )
  from privilege_matrix m
  group by m.role_name, m.table_name

  union all
  -- No grants to PUBLIC, at table or column level
  select
    'no PUBLIC grants (table or column): public.' || t.table_name,
    not exists (
      select 1
      from pg_catalog.pg_class c, aclexplode(c.relacl) x
      where c.oid = to_regclass(format('public.%I', t.table_name)) and x.grantee = 0
    )
    and not exists (
      select 1
      from pg_catalog.pg_attribute a, aclexplode(a.attacl) x
      where a.attrelid = to_regclass(format('public.%I', t.table_name)) and x.grantee = 0
    ),
    null
  from target_tables t

  union all
  -- Constraints and unique indexes
  select
    format('constraint exists: %s.%s', e.table_name, e.constraint_name),
    exists (
      select 1
      from pg_catalog.pg_constraint k
      where k.conrelid = to_regclass(format('public.%I', e.table_name))
        and k.conname = e.constraint_name
        and k.convalidated
    ),
    null
  from expected_constraints e
  union all
  select
    'unique constraint on conversations.direct_key',
    exists (
      select 1
      from pg_catalog.pg_constraint k
      where k.conrelid = to_regclass('public.conversations')
        and k.contype = 'u'
        and k.conkey = array[(
          select a.attnum
          from pg_catalog.pg_attribute a
          where a.attrelid = to_regclass('public.conversations') and a.attname = 'direct_key'
        )]
    ),
    null
  union all
  select
    'unique index messages_attachment_path_key',
    exists (
      select 1
      from pg_catalog.pg_index i
      where i.indexrelid = to_regclass('public.messages_attachment_path_key') and i.indisunique
    ),
    null

  union all
  -- Functions: exist, SECURITY DEFINER, empty search_path, no PUBLIC/anon EXECUTE
  select 'function exists: ' || f.signature, f.oid is not null, null from functions f
  union all
  select 'security definer: ' || f.signature, coalesce(f.prosecdef, false), null from functions f
  union all
  select
    'search_path is empty: ' || f.signature,
    coalesce('search_path=""' = any (f.proconfig), false),
    'proconfig: ' || coalesce(array_to_string(f.proconfig, ', '), 'none')
  from functions f
  union all
  select
    'no PUBLIC execute: ' || f.signature,
    f.proacl is not null
      and not exists (select 1 from aclexplode(f.proacl) x where x.grantee = 0 and x.privilege_type = 'EXECUTE'),
    null
  from functions f
  union all
  select
    'anon cannot execute: ' || f.signature,
    f.oid is not null and not has_function_privilege('anon', f.oid, 'EXECUTE'),
    null
  from functions f
  union all
  select
    format('authenticated execute = %s: %s', f.authenticated_can_execute, f.signature),
    f.oid is not null and has_function_privilege('authenticated', f.oid, 'EXECUTE') = f.authenticated_can_execute,
    null
  from functions f
  union all
  select
    'no unexpected functions in schema private',
    (
      select count(*)
      from pg_catalog.pg_proc p
      where p.pronamespace = 'private'::regnamespace
    ) = 4,
    (
      select 'found: ' || coalesce(string_agg(p.oid::regprocedure::text, ', ' order by p.proname), 'none')
      from pg_catalog.pg_proc p
      where p.pronamespace = 'private'::regnamespace
    )
  union all
  select
    'no SECURITY DEFINER function in public/private is executable by anon',
    not exists (
      select 1
      from pg_catalog.pg_proc p
      where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
        and p.prosecdef
        and has_function_privilege('anon', p.oid, 'EXECUTE')
    ),
    (
      select 'offending: ' || string_agg(p.oid::regprocedure::text, ', ')
      from pg_catalog.pg_proc p
      where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
        and p.prosecdef
        and has_function_privilege('anon', p.oid, 'EXECUTE')
    )
  union all
  select
    'storage.foldername(text) exists',
    to_regprocedure('storage.foldername(text)') is not null,
    null

  union all
  -- Schema "private"
  select 'anon has no USAGE on schema private', not has_schema_privilege('anon', 'private', 'USAGE'), null
  union all
  select 'authenticated has USAGE on schema private', has_schema_privilege('authenticated', 'private', 'USAGE'), null
  union all
  select
    'no PUBLIC USAGE on schema private',
    not exists (
      select 1
      from pg_catalog.pg_namespace n, aclexplode(n.nspacl) x
      where n.nspname = 'private' and x.grantee = 0
    ),
    null

  union all
  -- Policies: exist with this name, for this command, PERMISSIVE, for authenticated only,
  -- and with exactly the approved USING / WITH CHECK (null must stay null).
  select
    format('policy ok: %s.%s "%s" (%s)', e.schema_name, e.table_name, e.policy_name, e.command),
    exists (
      select 1
      from pg_catalog.pg_policies p
      where p.schemaname = e.schema_name
        and p.tablename = e.table_name
        and p.policyname = e.policy_name
        and p.cmd = e.command
        and p.permissive = 'PERMISSIVE'
        and p.roles = array['authenticated']::name[]
        and p.qual is not distinct from e.expected_using
        and p.with_check is not distinct from e.expected_check
    ),
    -- On a mismatch, show actual vs. expected; <null> marks a missing expression.
    coalesce((
      select
        case
          when p.qual is not distinct from e.expected_using
           and p.with_check is not distinct from e.expected_check
          then format('cmd=%s, %s, roles=%s', p.cmd, p.permissive, p.roles)
          else format(
            'cmd=%s, %s, roles=%s | USING actual: %s | USING expected: %s | CHECK actual: %s | CHECK expected: %s',
            p.cmd, p.permissive, p.roles,
            coalesce(p.qual, '<null>'), coalesce(e.expected_using, '<null>'),
            coalesce(p.with_check, '<null>'), coalesce(e.expected_check, '<null>')
          )
        end
      from pg_catalog.pg_policies p
      where p.schemaname = e.schema_name and p.tablename = e.table_name and p.policyname = e.policy_name
    ), 'policy not found')
  from expected_policies e
  union all
  select
    'exactly 7 policies on ChatSOS tables',
    (
      select count(*)
      from pg_catalog.pg_policies p
      where p.schemaname = 'public'
        and p.tablename in (select table_name from target_tables)
    ) = 7,
    (
      select 'count: ' || count(*)
      from pg_catalog.pg_policies p
      where p.schemaname = 'public'
        and p.tablename in (select table_name from target_tables)
    )
  union all
  -- Every policy on storage.objects, whatever bucket or expression it uses: a policy
  -- applies to all buckets unless it filters bucket_id itself, so any extra one
  -- (e.g. "using (true)") could expose attachments. Only the 2 expected may exist.
  select
    'exactly 2 policies on storage.objects (all buckets), both expected',
    (
      select count(*)
      from pg_catalog.pg_policies p
      where p.schemaname = 'storage' and p.tablename = 'objects'
    ) = 2
    and not exists (
      select 1
      from pg_catalog.pg_policies p
      where p.schemaname = 'storage'
        and p.tablename = 'objects'
        and not exists (
          select 1
          from expected_policies e
          where e.schema_name = 'storage'
            and e.table_name = 'objects'
            and e.policy_name = p.policyname
            and e.command = p.cmd
        )
    ),
    (
      select 'found: ' || coalesce(
        string_agg(
          format('%s (%s, %s, roles=%s)', p.policyname, p.cmd, p.permissive, p.roles),
          '; ' order by p.policyname
        ),
        'none'
      )
      from pg_catalog.pg_policies p
      where p.schemaname = 'storage' and p.tablename = 'objects'
    )

  union all
  -- Bucket configuration
  select
    'bucket attachments exists and is private',
    exists (select 1 from storage.buckets b where b.id = 'attachments' and b.public = false),
    null
  union all
  select
    'bucket attachments file_size_limit = 20 MB',
    exists (select 1 from storage.buckets b where b.id = 'attachments' and b.file_size_limit = 20971520),
    (select 'actual: ' || coalesce(b.file_size_limit::text, 'none') from storage.buckets b where b.id = 'attachments')
  union all
  select
    'bucket attachments allowed_mime_types match the allowlist',
    coalesce((
      select
        (select array_agg(x order by x) from unnest(b.allowed_mime_types) as x)
        = (select array_agg(mime order by mime) from expected_mime_types)
      from storage.buckets b
      where b.id = 'attachments'
    ), false),
    null

  union all
  -- Columns the attachment trigger relies on
  select
    'storage.objects has column ' || col,
    exists (
      select 1
      from information_schema.columns c
      where c.table_schema = 'storage' and c.table_name = 'objects' and c.column_name = col
    ),
    null
  from unnest(array['owner_id', 'metadata', 'bucket_id', 'name']) as col

  union all
  -- Triggers present and enabled
  select
    format('trigger enabled: %s on %s', t.trigger_name, t.table_name),
    exists (
      select 1
      from pg_catalog.pg_trigger g
      where g.tgrelid = to_regclass(t.table_name)
        and g.tgname = t.trigger_name
        and g.tgenabled <> 'D'
    ),
    null
  from (
    values
      ('on_auth_user_created', 'auth.users'),
      ('messages_validate_attachment', 'public.messages'),
      ('messages_touch_conversation', 'public.messages')
  ) as t (trigger_name, table_name)

  union all
  -- Realtime publication (necessary, not sufficient; delivery is tested in step 1D)
  select
    'public.messages is in publication supabase_realtime',
    exists (
      select 1
      from pg_catalog.pg_publication_tables pt
      where pt.pubname = 'supabase_realtime'
        and pt.schemaname = 'public'
        and pt.tablename = 'messages'
    ),
    null
)
select name, ok, detail
from (
  select name, coalesce(ok, false) as ok, detail from checks
  union all
  select
    '== ALL CHECKS PASSED ==',
    bool_and(coalesce(ok, false)),
    count(*) filter (where not coalesce(ok, false)) || ' failing of ' || count(*)
  from checks
) as results
order by ok, name;
