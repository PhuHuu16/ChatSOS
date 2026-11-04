-- ChatSOS · read-only verification. Run after all 13 migrations (the 5 of Phase 1,
-- 20261028000100_edit_recall_messages.sql, 20261028000200_typing_and_read_receipts.sql,
-- 20261029000100_avatars.sql, 20261030000100_delete_messages_and_conversations.sql,
-- 20261031000100_phone_and_admin_users.sql, 20261101000100_rate_limits.sql,
-- 20261102000100_group_management.sql and 20261104000100_foreign_key_indexes.sql).
-- Rate-limit behaviour (counting, refusing) is tested by rate_limits_behaviour.sql, group
-- management (RPCs, system messages, history since joining) by group_management_behaviour.sql.
-- A single SELECT: it changes nothing (the functions it calls only read). Failing checks
-- are listed first, and the "== ALL CHECKS PASSED ==" row is true only when every check
-- passed. Needs at least one existing profile (for the "username taken" hook check).
--
-- Not covered here (check by hand or in step 1D):
--   * Settings > Data API > Exposed schemas must NOT include "private" or "admin".
--   * Whether the Before User Created hook is enabled (Dashboard > Authentication > Hooks).
--   * Real RLS behaviour and Realtime delivery are tested end to end in step 1D.

with
target_tables (table_name) as (
  values
    ('profiles'),
    ('conversations'),
    ('conversation_members'),
    ('messages'),
    ('message_hides'),
    ('conversation_clears'),
    ('conversation_removals')
),
target_roles (role_name) as (
  values ('anon'), ('authenticated')
),
-- The complete allowlist. Anything granted that is not listed here is reported
-- as UNEXPECTED; anything listed that is not granted is reported as MISSING.
-- column_name null = table-level grant (covers every column of the table).
-- profiles.phone is deliberately absent: no client role may read or change it.
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
    ('authenticated', 'messages', 'INSERT', 'attachment_mime'),
    ('authenticated', 'messages', 'UPDATE', 'content'),
    ('authenticated', 'messages', 'UPDATE', 'deleted_at'),
    ('authenticated', 'message_hides', 'SELECT', null),
    ('authenticated', 'message_hides', 'INSERT', 'message_id'),
    ('authenticated', 'conversation_clears', 'SELECT', null),
    ('authenticated', 'conversation_removals', 'SELECT', null)
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
-- security_definer false only for the helpers normalize_vn_phone, hit_rate_limit and
-- lock_group, which run inside the definer functions that call them.
expected_functions (signature, authenticated_can_execute, security_definer) as (
  values
    ('public.handle_new_user()', false, true),
    ('public.create_direct_conversation(uuid)', true, true),
    ('public.create_group_conversation(text, uuid[])', true, true),
    ('private.is_member(uuid)', true, true),
    ('private.can_access_attachment(text)', true, true),
    ('private.validate_message_attachment()', false, true),
    ('private.touch_conversation()', false, true),
    ('private.guard_message_update()', false, true),
    ('private.attachment_unused(text)', true, true),
    ('private.can_use_typing_topic(text)', true, true),
    ('private.avatar_in_use(text)', true, true),
    ('private.validate_profile_avatar()', false, true),
    ('public.clear_conversation(uuid)', true, true),
    ('private.can_hide_message(uuid)', true, true),
    ('private.normalize_vn_phone(text)', false, false),
    ('public.hook_before_user_created(jsonb)', false, true),
    ('public.find_profile_by_phone(text)', true, true),
    ('private.hit_rate_limit(text, interval, integer)', false, false),
    ('public.phone_sign_in_check(text, text)', false, true),
    ('public.phone_sign_in_succeeded(text)', false, true),
    ('private.member_since(uuid)', true, true),
    ('private.can_read_attachment(text)', true, true),
    ('private.lock_group(uuid)', false, false),
    ('public.rename_group(uuid, text)', true, true),
    ('public.add_group_members(uuid, uuid[])', true, true),
    ('public.remove_group_member(uuid, uuid)', true, true),
    ('public.transfer_group_ownership(uuid, uuid)', true, true),
    ('public.leave_group(uuid)', true, true)
),
functions as (
  select e.signature, e.authenticated_can_execute, e.security_definer, p.oid, p.prosecdef, p.proconfig, p.proacl
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
    -- Replaced in migration 9: "members can read", minus the messages the caller hid and
    -- those up to when the caller cleared the conversation. Replaced again in migration 12:
    -- "is a member" became "sent since the caller joined" (written by hand in the printed
    -- form; compare the detail column if it fails).
    ('public', 'messages', 'messages: members read what was sent since they joined', 'SELECT',
      E'((created_at >= private.member_since(conversation_id)) AND (NOT (EXISTS ( SELECT 1\n   FROM message_hides h\n  WHERE ((h.message_id = messages.id) AND (h.user_id = ( SELECT auth.uid() AS uid)))))) AND (NOT (EXISTS ( SELECT 1\n   FROM conversation_clears c\n  WHERE ((c.conversation_id = messages.conversation_id) AND (c.user_id = ( SELECT auth.uid() AS uid)) AND (messages.created_at <= c.cleared_at))))))',
      null::text),
    -- Migration 12 added "kind <> 'system'".
    ('public', 'messages', 'messages: members send as themselves', 'INSERT',
      null::text,
      '((sender_id = ( SELECT auth.uid() AS uid)) AND (kind <> ''system''::text) AND private.is_member(conversation_id))'),
    ('public', 'messages', 'messages: senders change their own', 'UPDATE',
      '((sender_id = ( SELECT auth.uid() AS uid)) AND private.is_member(conversation_id))',
      '((sender_id = ( SELECT auth.uid() AS uid)) AND private.is_member(conversation_id))'),
    -- Replaced in migration 12 (was "members can read" every file of the folder).
    ('storage', 'objects', 'attachments: members read files of messages they can see', 'SELECT',
      '((bucket_id = ''attachments''::text) AND (private.can_read_attachment(name) OR ((owner_id = (( SELECT auth.uid() AS uid))::text) AND private.can_access_attachment(name))))',
      null::text),
    ('storage', 'objects', 'attachments: members can upload new files', 'INSERT',
      null::text,
      '((bucket_id = ''attachments''::text) AND (name ~ ''^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|gif|pdf|txt|zip|docx|xlsx|pptx)$''::text) AND private.can_access_attachment(name))'),
    ('realtime', 'messages', 'realtime: members receive typing', 'SELECT',
      '((extension = ''broadcast''::text) AND private.can_use_typing_topic(( SELECT realtime.topic() AS topic)))',
      null::text),
    ('realtime', 'messages', 'realtime: members send typing', 'INSERT',
      null::text,
      '((extension = ''broadcast''::text) AND private.can_use_typing_topic(( SELECT realtime.topic() AS topic)))'),
    ('storage', 'objects', 'attachments: uploaders delete unused files', 'DELETE',
      '((bucket_id = ''attachments''::text) AND (owner_id = (( SELECT auth.uid() AS uid))::text) AND private.attachment_unused(name))',
      null::text),
    -- Avatars (migration 8). Written in the same printed form as the rows above; not yet
    -- captured from the deployed schema, so compare the detail column if one fails.
    ('storage', 'objects', 'avatars: read avatars in use or own files', 'SELECT',
      '((bucket_id = ''avatars''::text) AND (private.avatar_in_use(name) OR ((owner_id = (( SELECT auth.uid() AS uid))::text) AND (split_part(name, ''/''::text, 1) = (( SELECT auth.uid() AS uid))::text))))',
      null::text),
    ('storage', 'objects', 'avatars: users upload to their own folder', 'INSERT',
      null::text,
      '((bucket_id = ''avatars''::text) AND (char_length(name) = 77) AND (name ~ ''^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$''::text) AND (split_part(name, ''/''::text, 1) = (( SELECT auth.uid() AS uid))::text))'),
    ('storage', 'objects', 'avatars: owners delete unused files', 'DELETE',
      '((bucket_id = ''avatars''::text) AND (owner_id = (( SELECT auth.uid() AS uid))::text) AND (split_part(name, ''/''::text, 1) = (( SELECT auth.uid() AS uid))::text) AND (NOT private.avatar_in_use(name)))',
      null::text),
    -- Migration 9. Written in the same printed form; not yet captured from the deployed
    -- schema, so compare the detail column if one fails.
    ('public', 'message_hides', 'message_hides: users read their own', 'SELECT',
      '(user_id = ( SELECT auth.uid() AS uid))',
      null::text),
    ('public', 'message_hides', 'message_hides: members hide messages for themselves', 'INSERT',
      null::text,
      '((user_id = ( SELECT auth.uid() AS uid)) AND private.can_hide_message(message_id))'),
    ('public', 'conversation_clears', 'conversation_clears: users read their own', 'SELECT',
      '(user_id = ( SELECT auth.uid() AS uid))',
      null::text),
    -- Migration 12.
    ('public', 'conversation_removals', 'conversation_removals: users read their own', 'SELECT',
      '(user_id = ( SELECT auth.uid() AS uid))',
      null::text)
),
expected_constraints (table_name, constraint_name) as (
  values
    ('profiles', 'profiles_username_format'),
    ('profiles', 'profiles_display_name_valid'),
    ('profiles', 'profiles_avatar_path_valid'),
    ('profiles', 'profiles_phone_format'),
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
    ('messages', 'messages_image_is_image'),
    ('messages', 'messages_edited_text_only'),
    ('messages', 'messages_system_event_valid')
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
  -- Foreign key indexes (migration 13): the index starts with the key column.
  select
    format('index %s on public.%s (%s)', x.index_name, x.table_name, x.column_name),
    exists (
      select 1
      from pg_catalog.pg_index i
      join pg_catalog.pg_attribute a
        on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
      where i.indexrelid = to_regclass(format('public.%I', x.index_name))
        and i.indrelid = to_regclass(format('public.%I', x.table_name))
        and a.attname = x.column_name
    ),
    null
  from (
    values
      ('messages_sender_id_idx', 'messages', 'sender_id'),
      ('conversations_created_by_idx', 'conversations', 'created_by')
  ) as x (index_name, table_name, column_name)

  union all
  -- Functions: exist, SECURITY DEFINER as expected, empty search_path, no PUBLIC/anon EXECUTE
  select 'function exists: ' || f.signature, f.oid is not null, null from functions f
  union all
  select
    format('security definer = %s: %s', f.security_definer, f.signature),
    f.oid is not null and f.prosecdef = f.security_definer,
    null
  from functions f
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
    ) = 15,
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
    'exactly 12 policies on ChatSOS tables',
    (
      select count(*)
      from pg_catalog.pg_policies p
      where p.schemaname = 'public'
        and p.tablename in (select table_name from target_tables)
    ) = 12,
    (
      select 'count: ' || count(*)
      from pg_catalog.pg_policies p
      where p.schemaname = 'public'
        and p.tablename in (select table_name from target_tables)
    )
  union all
  -- Every policy on storage.objects, whatever bucket or expression it uses: a policy
  -- applies to all buckets unless it filters bucket_id itself, so any extra one
  -- (e.g. "using (true)") could expose attachments. Only the 6 expected may exist
  -- (3 for attachments, 3 for avatars).
  select
    'exactly 6 policies on storage.objects (all buckets), all expected',
    (
      select count(*)
      from pg_catalog.pg_policies p
      where p.schemaname = 'storage' and p.tablename = 'objects'
    ) = 6
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
  -- No bucket may let clients overwrite files: upsert needs an UPDATE policy.
  select
    'no UPDATE or ALL policy on storage.objects',
    not exists (
      select 1
      from pg_catalog.pg_policies p
      where p.schemaname = 'storage' and p.tablename = 'objects' and p.cmd in ('UPDATE', 'ALL')
    ),
    (
      select 'found: ' || string_agg(format('%s (%s)', p.policyname, p.cmd), '; ')
      from pg_catalog.pg_policies p
      where p.schemaname = 'storage' and p.tablename = 'objects' and p.cmd in ('UPDATE', 'ALL')
    )

  union all
  -- Realtime Authorization: only the 2 typing policies may exist on realtime.messages,
  -- so no other private channel can be joined.
  select
    'exactly 2 policies on realtime.messages, both expected',
    (
      select count(*)
      from pg_catalog.pg_policies p
      where p.schemaname = 'realtime' and p.tablename = 'messages'
    ) = 2
    and not exists (
      select 1
      from pg_catalog.pg_policies p
      where p.schemaname = 'realtime'
        and p.tablename = 'messages'
        and not exists (
          select 1
          from expected_policies e
          where e.schema_name = 'realtime'
            and e.table_name = 'messages'
            and e.policy_name = p.policyname
            and e.command = p.cmd
        )
    ),
    (
      select 'found: ' || coalesce(string_agg(p.policyname, '; ' order by p.policyname), 'none')
      from pg_catalog.pg_policies p
      where p.schemaname = 'realtime' and p.tablename = 'messages'
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
  select
    'bucket avatars exists and is private',
    exists (select 1 from storage.buckets b where b.id = 'avatars' and b.public = false),
    null
  union all
  select
    'bucket avatars file_size_limit = 1 MiB',
    exists (select 1 from storage.buckets b where b.id = 'avatars' and b.file_size_limit = 1048576),
    (select 'actual: ' || coalesce(b.file_size_limit::text, 'none') from storage.buckets b where b.id = 'avatars')
  union all
  select
    'bucket avatars allowed_mime_types = {image/jpeg}',
    exists (
      select 1
      from storage.buckets b
      where b.id = 'avatars' and b.allowed_mime_types = array['image/jpeg']::text[]
    ),
    (select 'actual: ' || coalesce(b.allowed_mime_types::text, 'none') from storage.buckets b where b.id = 'avatars')

  union all
  -- Columns the attachment and avatar triggers rely on
  select
    'storage.objects has column ' || col,
    exists (
      select 1
      from information_schema.columns c
      where c.table_schema = 'storage' and c.table_name = 'objects' and c.column_name = col
    ),
    null
  from unnest(array['owner_id', 'metadata', 'bucket_id', 'name', 'is_delete_marker']) as col

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
      ('messages_touch_conversation', 'public.messages'),
      ('messages_guard_update', 'public.messages'),
      ('profiles_validate_avatar', 'public.profiles')
  ) as t (trigger_name, table_name)
  union all
  -- The avatar trigger: exact timing, events, column and function.
  select
    'trigger definition: profiles_validate_avatar',
    exists (
      select 1
      from pg_catalog.pg_trigger g
      where g.tgrelid = to_regclass('public.profiles')
        and g.tgname = 'profiles_validate_avatar'
        and pg_get_triggerdef(g.oid) = 'CREATE TRIGGER profiles_validate_avatar BEFORE INSERT OR UPDATE OF avatar_path ON public.profiles FOR EACH ROW EXECUTE FUNCTION private.validate_profile_avatar()'
    ),
    (
      select 'actual: ' || pg_get_triggerdef(g.oid)
      from pg_catalog.pg_trigger g
      where g.tgrelid = to_regclass('public.profiles') and g.tgname = 'profiles_validate_avatar'
    )
  union all
  -- The avatar functions still contain the conditions the security model relies on.
  select
    'function body: private.validate_profile_avatar() ' || frag.label,
    coalesce((
      select position(frag.needle in p.prosrc) > 0
      from pg_catalog.pg_proc p
      where p.oid = to_regprocedure('private.validate_profile_avatar()')
    ), false),
    null
  from (
    values
      ('reads bucket avatars', 'o.bucket_id = ''avatars'''),
      ('reads the exact object', 'o.name = new.avatar_path'),
      ('skips delete markers', 'coalesce(o.is_delete_marker, false) = false'),
      ('rejects a missing file', 'if not found then'),
      ('checks the owner', 'v_owner is distinct from new.id::text'),
      ('checks the MIME type', '''image/jpeg'''),
      ('checks the size limit', 'v_size > 1048576'),
      ('checks the path length', 'char_length(new.avatar_path) = 77'),
      ('checks the path pattern', 'new.avatar_path ~ ''^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'''),
      ('checks the own folder', 'split_part(new.avatar_path, ''/'', 1) = new.id::text')
  ) as frag (label, needle)
  union all
  select
    'function body: private.avatar_in_use(text) checks every profile',
    coalesce((
      select position('from public.profiles p' in p.prosrc) > 0
        and position('p.avatar_path = p_object_name' in p.prosrc) > 0
      from pg_catalog.pg_proc p
      where p.oid = to_regprocedure('private.avatar_in_use(text)')
    ), false),
    null
  union all
  select
    'unique index profiles_avatar_path_key',
    coalesce(
      pg_get_indexdef(to_regclass('public.profiles_avatar_path_key'))
        = 'CREATE UNIQUE INDEX profiles_avatar_path_key ON public.profiles USING btree (avatar_path)',
      false
    ),
    'actual: ' || coalesce(pg_get_indexdef(to_regclass('public.profiles_avatar_path_key')), 'none')

  union all
  -- Realtime publication (necessary, not sufficient; delivery is tested end to end)
  select
    format('public.%s is in publication supabase_realtime', t.table_name),
    exists (
      select 1
      from pg_catalog.pg_publication_tables pt
      where pt.pubname = 'supabase_realtime'
        and pt.schemaname = 'public'
        and pt.tablename = t.table_name
    ),
    null
  from (values ('messages'), ('conversation_members'), ('conversation_removals')) as t (table_name)
  union all
  -- Supabase does not check RLS for DELETE events, so none may be published.
  select
    'publication supabase_realtime publishes insert and update, not delete',
    exists (
      select 1
      from pg_catalog.pg_publication p
      where p.pubname = 'supabase_realtime' and p.pubinsert and p.pubupdate and not p.pubdelete
    ),
    (
      select format('insert=%s update=%s delete=%s truncate=%s', p.pubinsert, p.pubupdate, p.pubdelete, p.pubtruncate)
      from pg_catalog.pg_publication p
      where p.pubname = 'supabase_realtime'
    )

  union all
  -- Hides disappear with their message and with their user.
  select
    'message_hides foreign keys cascade on delete (messages, profiles)',
    (
      select count(*)
      from pg_catalog.pg_constraint k
      where k.conrelid = to_regclass('public.message_hides')
        and k.contype = 'f'
        and k.confdeltype = 'c'
        and k.confrelid in (to_regclass('public.messages'), to_regclass('public.profiles'))
    ) = 2,
    null
  union all
  select
    'primary key message_hides (user_id, message_id)',
    coalesce(
      pg_get_indexdef(to_regclass('public.message_hides_pkey'))
        = 'CREATE UNIQUE INDEX message_hides_pkey ON public.message_hides USING btree (user_id, message_id)',
      false
    ),
    'actual: ' || coalesce(pg_get_indexdef(to_regclass('public.message_hides_pkey')), 'none')
  union all
  -- Clears disappear with their conversation and with their user.
  select
    'conversation_clears foreign keys cascade on delete (conversations, profiles)',
    (
      select count(*)
      from pg_catalog.pg_constraint k
      where k.conrelid = to_regclass('public.conversation_clears')
        and k.contype = 'f'
        and k.confdeltype = 'c'
        and k.confrelid in (to_regclass('public.conversations'), to_regclass('public.profiles'))
    ) = 2,
    null
  union all
  select
    'primary key conversation_clears (user_id, conversation_id)',
    coalesce(
      pg_get_indexdef(to_regclass('public.conversation_clears_pkey'))
        = 'CREATE UNIQUE INDEX conversation_clears_pkey ON public.conversation_clears USING btree (user_id, conversation_id)',
      false
    ),
    'actual: ' || coalesce(pg_get_indexdef(to_regclass('public.conversation_clears_pkey')), 'none')
  union all
  -- clear_conversation still contains the conditions the security model relies on.
  select
    'function body: public.clear_conversation(uuid) ' || frag.label,
    coalesce((
      select position(frag.needle in p.prosrc) > 0
      from pg_catalog.pg_proc p
      where p.oid = to_regprocedure('public.clear_conversation(uuid)')
    ), false),
    null
  from (
    values
      ('checks the caller is a member', 'm.user_id = v_me'),
      ('same error for not a member and not found', 'errcode = ''P0002'''),
      ('writes only for the caller, with the server clock', 'values (v_me, p_conversation_id, now())'),
      ('never moves the mark back', 'greatest(public.conversation_clears.cleared_at, excluded.cleared_at)')
  ) as frag (label, needle)

  union all
  -- Migration 10: phone column. Printed forms written by hand; not yet captured from the
  -- deployed schema, so compare the detail column if one fails.
  select
    'constraint definition: profiles_phone_format',
    coalesce((
      select pg_get_constraintdef(k.oid)
      from pg_catalog.pg_constraint k
      where k.conrelid = to_regclass('public.profiles') and k.conname = 'profiles_phone_format'
    ) = 'CHECK (((phone IS NULL) OR (phone ~ ''^\+84[35789][0-9]{8}$''::text)))', false),
    (
      select 'actual: ' || pg_get_constraintdef(k.oid)
      from pg_catalog.pg_constraint k
      where k.conrelid = to_regclass('public.profiles') and k.conname = 'profiles_phone_format'
    )
  union all
  select
    'unique index profiles_phone_key',
    coalesce(
      pg_get_indexdef(to_regclass('public.profiles_phone_key'))
        = 'CREATE UNIQUE INDEX profiles_phone_key ON public.profiles USING btree (phone)',
      false
    ),
    'actual: ' || coalesce(pg_get_indexdef(to_regclass('public.profiles_phone_key')), 'none')
  union all
  -- normalize_vn_phone is pure, so its behaviour can be checked here directly.
  select
    format('normalize_vn_phone(%L) = %s', c.input, coalesce(c.expected, 'null')),
    case
      when to_regprocedure('private.normalize_vn_phone(text)') is null then false
      else private.normalize_vn_phone(c.input) is not distinct from c.expected
    end,
    case
      when to_regprocedure('private.normalize_vn_phone(text)') is null then 'function missing'
      else 'actual: ' || coalesce(private.normalize_vn_phone(c.input), 'null')
    end
  from (
    values
      ('0912345678', '+84912345678'),
      ('84912345678', '+84912345678'),
      ('+84912345678', '+84912345678'),
      (' 091 234-56.78 ', '+84912345678'),
      ('(+84) 38 123 4567', '+84381234567'),
      ('0312345678', '+84312345678'),
      ('0512345678', '+84512345678'),
      ('0712345678', '+84712345678'),
      ('0812345678', '+84812345678'),
      ('0212345678', null),
      ('0112345678', null),
      ('091234567', null),
      ('09123456789', null),
      ('+840912345678', null),
      ('+1 415 555 2671', null),
      ('09l2345678', null),
      ('', null),
      (null, null)
  ) as c (input, expected)
  union all
  -- handle_new_user stores the phone and rejects a missing or invalid one.
  select
    'function body: public.handle_new_user() ' || frag.label,
    coalesce((
      select position(frag.needle in p.prosrc) > 0
      from pg_catalog.pg_proc p
      where p.oid = to_regprocedure('public.handle_new_user()')
    ), false),
    null
  from (
    values
      ('normalizes the phone', 'private.normalize_vn_phone(new.raw_user_meta_data ->> ''phone'')'),
      ('rejects an invalid phone', 'raise exception ''invalid phone'''),
      ('stores the phone', 'insert into public.profiles (id, username, display_name, phone)')
  ) as frag (label, needle)
  union all
  -- The hook: only Supabase Auth may call it, and it answers as the app expects.
  select
    'supabase_auth_admin can execute public.hook_before_user_created(jsonb)',
    to_regprocedure('public.hook_before_user_created(jsonb)') is not null
      and has_function_privilege('supabase_auth_admin', to_regprocedure('public.hook_before_user_created(jsonb)'), 'EXECUTE'),
    null
  union all
  select
    'supabase_auth_admin has USAGE on schema public',
    has_schema_privilege('supabase_auth_admin', 'public', 'USAGE'),
    null
  union all
  select
    'hook: ' || h.label,
    case
      when to_regprocedure('public.hook_before_user_created(jsonb)') is null then false
      else public.hook_before_user_created(h.event) = h.expected
    end,
    case
      when to_regprocedure('public.hook_before_user_created(jsonb)') is null then 'function missing'
      else 'actual: ' || public.hook_before_user_created(h.event)::text
    end
  from (
    values
      ('allows new valid data',
        '{"user": {"user_metadata": {"username": "verify_unused_zz9", "display_name": "V", "phone": "0399999999"}}}'::jsonb,
        '{}'::jsonb),
      ('passes through a request without ChatSOS data',
        '{"user": {"user_metadata": {}}}'::jsonb,
        '{}'::jsonb),
      ('rejects an invalid username',
        '{"user": {"user_metadata": {"username": "a b", "phone": "0399999999"}}}'::jsonb,
        '{"error": {"http_code": 400, "message": "chatsos:username_invalid"}}'::jsonb),
      ('rejects a missing phone',
        '{"user": {"user_metadata": {"username": "verify_unused_zz9"}}}'::jsonb,
        '{"error": {"http_code": 400, "message": "chatsos:phone_invalid"}}'::jsonb),
      ('rejects an invalid phone',
        '{"user": {"user_metadata": {"username": "verify_unused_zz9", "phone": "0212345678"}}}'::jsonb,
        '{"error": {"http_code": 400, "message": "chatsos:phone_invalid"}}'::jsonb)
  ) as h (label, event, expected)
  union all
  -- Uses an existing username in upper case, so it also checks the lowercasing.
  select
    'hook: rejects a taken username (any case)',
    coalesce((
      select public.hook_before_user_created(jsonb_build_object('user', jsonb_build_object(
               'user_metadata', jsonb_build_object('username', upper(p.username), 'phone', '0399999999'))))
             = '{"error": {"http_code": 409, "message": "chatsos:username_taken"}}'::jsonb
      from public.profiles p
      order by p.username
      limit 1
    ), false),
    'needs at least one profile'
  union all
  -- Only checkable once some profile has a phone; until then it passes and says so.
  select
    'hook: rejects a taken phone (written as 0…)',
    coalesce((
      select public.hook_before_user_created(jsonb_build_object('user', jsonb_build_object(
               'user_metadata', jsonb_build_object('username', 'verify_unused_zz9', 'phone', '0' || substr(p.phone, 4)))))
             = '{"error": {"http_code": 409, "message": "chatsos:phone_taken"}}'::jsonb
      from public.profiles p
      where p.phone is not null
      order by p.phone
      limit 1
    ), true),
    case
      when exists (select 1 from public.profiles p where p.phone is not null) then 'checked with a stored phone'
      else 'skipped: no profile has a phone yet'
    end
  union all
  -- find_profile_by_phone returns no phone column and keeps its safety conditions.
  select
    'find_profile_by_phone returns (id, username, display_name, avatar_path) only',
    coalesce(
      pg_get_function_result(to_regprocedure('public.find_profile_by_phone(text)'))
        = 'TABLE(id uuid, username text, display_name text, avatar_path text)',
      false
    ),
    'actual: ' || coalesce(pg_get_function_result(to_regprocedure('public.find_profile_by_phone(text)')), 'none')
  union all
  select
    'function body: public.find_profile_by_phone(text) ' || frag.label,
    coalesce((
      select position(frag.needle in p.prosrc) > 0
      from pg_catalog.pg_proc p
      where p.oid = to_regprocedure('public.find_profile_by_phone(text)')
    ), false),
    null
  from (
    values
      ('requires a signed-in caller', 'errcode = ''42501'''),
      ('matches the exact number', 'where p.phone = v_phone'),
      ('never returns the caller', 'and p.id <> v_me')
  ) as frag (label, needle)
  union all
  -- admin.users: Dashboard only.
  select 'schema admin exists', to_regnamespace('admin') is not null, null
  union all
  select
    format('%s has no USAGE on schema admin', r.role_name),
    to_regnamespace('admin') is not null and not has_schema_privilege(r.role_name, 'admin', 'USAGE'),
    null
  from target_roles r
  union all
  select
    'no PUBLIC USAGE on schema admin',
    to_regnamespace('admin') is not null
      and not exists (
        select 1
        from pg_catalog.pg_namespace n, aclexplode(n.nspacl) x
        where n.nspname = 'admin' and x.grantee = 0
      ),
    null
  union all
  select
    'view admin.users exists with security_invoker',
    exists (
      select 1
      from pg_catalog.pg_class c
      where c.oid = to_regclass('admin.users')
        and c.relkind = 'v'
        and 'security_invoker=true' = any (c.reloptions)
    ),
    (select 'reloptions: ' || coalesce(array_to_string(c.reloptions, ', '), 'none') from pg_catalog.pg_class c where c.oid = to_regclass('admin.users'))
  union all
  select
    format('%s has no privilege on admin.users', r.role_name),
    to_regclass('admin.users') is not null
      and not exists (
        select 1
        from (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) as p (privilege)
        where has_table_privilege(r.role_name, to_regclass('admin.users'), p.privilege)
      ),
    null
  from target_roles r
  union all
  select
    'no PUBLIC grant on admin.users',
    to_regclass('admin.users') is not null
      and not exists (
        select 1
        from pg_catalog.pg_class c, aclexplode(c.relacl) x
        where c.oid = to_regclass('admin.users') and x.grantee = 0
      ),
    null
  union all
  -- Exactly the approved columns, so no password or token column can slip in.
  select
    'admin.users columns are exactly the approved list',
    coalesce((
      select array_agg(a.attname::text order by a.attnum)
      from pg_catalog.pg_attribute a
      where a.attrelid = to_regclass('admin.users') and a.attnum > 0 and not a.attisdropped
    ) = array[
      'id', 'email', 'phone', 'username', 'display_name', 'avatar_path', 'created_at',
      'last_sign_in_at', 'email_confirmed_at', 'banned_until', 'conversations', 'messages_sent'
    ], false),
    (
      select 'actual: ' || coalesce(string_agg(a.attname::text, ', ' order by a.attnum), 'none')
      from pg_catalog.pg_attribute a
      where a.attrelid = to_regclass('admin.users') and a.attnum > 0 and not a.attisdropped
    )
  union all
  select
    'admin.users definition reads no password or token column',
    coalesce(
      pg_get_viewdef(to_regclass('admin.users')) !~* '(password|token|secret)',
      false
    ),
    null

  union all
  -- Migration 11: the counters are reachable only through the limit functions.
  select
    'RLS enabled: private.rate_limit_counters',
    coalesce((
      select c.relrowsecurity
      from pg_catalog.pg_class c
      where c.oid = to_regclass('private.rate_limit_counters')
    ), false),
    null
  union all
  select
    format('%s has no privilege on private.rate_limit_counters', r.role_name),
    to_regclass('private.rate_limit_counters') is not null
      and not exists (
        select 1
        from (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) as p (privilege)
        where has_table_privilege(r.role_name, to_regclass('private.rate_limit_counters'), p.privilege)
      ),
    null
  from (values ('anon'), ('authenticated'), ('service_role')) as r (role_name)
  union all
  select
    'no PUBLIC grant on private.rate_limit_counters',
    to_regclass('private.rate_limit_counters') is not null
      and not exists (
        select 1
        from pg_catalog.pg_class c, aclexplode(c.relacl) x
        where c.oid = to_regclass('private.rate_limit_counters') and x.grantee = 0
      ),
    null
  union all
  select
    'no policies on private.rate_limit_counters',
    not exists (
      select 1
      from pg_catalog.pg_policies p
      where p.schemaname = 'private' and p.tablename = 'rate_limit_counters'
    ),
    null
  union all
  select
    'primary key rate_limit_counters (bucket, window_start)',
    coalesce(
      pg_get_indexdef(to_regclass('private.rate_limit_counters_pkey'))
        = 'CREATE UNIQUE INDEX rate_limit_counters_pkey ON private.rate_limit_counters USING btree (bucket, window_start)',
      false
    ),
    'actual: ' || coalesce(pg_get_indexdef(to_regclass('private.rate_limit_counters_pkey')), 'none')
  union all
  -- Only the phone-sign-in Edge Function (service_role) records sign-in attempts; anon and
  -- authenticated are refused by the function checks above.
  select
    format('service_role can execute %s', s.signature),
    to_regprocedure(s.signature) is not null
      and has_function_privilege('service_role', to_regprocedure(s.signature), 'EXECUTE'),
    null
  from (values ('public.phone_sign_in_check(text, text)'), ('public.phone_sign_in_succeeded(text)')) as s (signature)
  union all
  -- A long wait on a counter row fails, which refuses the request, instead of hanging.
  select
    format('lock_timeout=2s: %s', s.signature),
    coalesce((
      select 'lock_timeout=2s' = any (p.proconfig)
      from pg_catalog.pg_proc p
      where p.oid = to_regprocedure(s.signature)
    ), false),
    null
  from (
    values
      ('public.phone_sign_in_check(text, text)'),
      ('public.phone_sign_in_succeeded(text)'),
      ('public.find_profile_by_phone(text)')
  ) as s (signature)
  union all
  select
    'find_profile_by_phone is VOLATILE (it records lookups)',
    coalesce((
      select p.provolatile = 'v'
      from pg_catalog.pg_proc p
      where p.oid = to_regprocedure('public.find_profile_by_phone(text)')
    ), false),
    null
  union all
  -- The lookup is counted before the search.
  select
    'find_profile_by_phone counts the lookup before reading profiles',
    coalesce((
      select x.limit_at > 0 and x.search_at > 0 and x.limit_at < x.search_at
      from (
        select
          position('private.hit_rate_limit(''phone_lookup:'' || v_me::text, interval ''10 minutes'', 20)' in p.prosrc) as limit_at,
          position('return query' in p.prosrc) as search_at
        from pg_catalog.pg_proc p
        where p.oid = to_regprocedure('public.find_profile_by_phone(text)')
      ) as x
    ), false),
    null
  union all
  select
    'function body: ' || frag.signature || ' ' || frag.label,
    coalesce((
      select position(frag.needle in p.prosrc) > 0
      from pg_catalog.pg_proc p
      where p.oid = to_regprocedure(frag.signature)
    ), false),
    null
  from (
    values
      ('public.find_profile_by_phone(text)', 'identifies the caller by auth.uid() only',
        'v_me uuid := (select auth.uid())'),
      ('public.find_profile_by_phone(text)', 'refuses with PT429 over the limit',
        'errcode = ''PT429'''),
      ('public.phone_sign_in_check(text, text)', 'allows 5 attempts per number per 15 minutes',
        '''signin_phone:'' || encode(sha256(convert_to(v_phone, ''UTF8'')), ''hex''), interval ''15 minutes'', 5)'),
      ('public.phone_sign_in_check(text, text)', 'allows 60 attempts per IP address per 15 minutes',
        '''signin_ip:'' || encode(sha256(convert_to(p_ip, ''UTF8'')), ''hex''), interval ''15 minutes'', 60)'),
      ('private.hit_rate_limit(text, interval, integer)', 'checks and records in one statement',
        'on conflict (bucket, window_start) do update set hits = c.hits + 1'),
      ('private.hit_rate_limit(text, interval, integer)', 'cleanup never waits on locked rows',
        'for update skip locked')
  ) as frag (signature, label, needle)

  union all
  -- Migration 12. Printed forms written by hand; not yet captured from the deployed schema,
  -- so compare the detail column if one fails.
  select
    'constraint definition: messages_kind_valid allows system',
    coalesce((
      select pg_get_constraintdef(k.oid)
      from pg_catalog.pg_constraint k
      where k.conrelid = to_regclass('public.messages') and k.conname = 'messages_kind_valid'
    ) = 'CHECK ((kind = ANY (ARRAY[''text''::text, ''image''::text, ''file''::text, ''system''::text])))', false),
    (
      select 'actual: ' || pg_get_constraintdef(k.oid)
      from pg_catalog.pg_constraint k
      where k.conrelid = to_regclass('public.messages') and k.conname = 'messages_kind_valid'
    )
  union all
  -- Clients cannot write the system columns (privilege matrix above); here, the target's key.
  select
    'messages.system_target_id references profiles, on delete set null',
    exists (
      select 1
      from pg_catalog.pg_constraint k
      where k.conrelid = to_regclass('public.messages')
        and k.contype = 'f'
        and k.confrelid = to_regclass('public.profiles')
        and k.confdeltype = 'n'
        and k.conkey = array[(
          select a.attnum
          from pg_catalog.pg_attribute a
          where a.attrelid = to_regclass('public.messages') and a.attname = 'system_target_id'
        )]
    ),
    null
  union all
  select
    'unique index conversation_members_one_owner',
    coalesce(
      pg_get_indexdef(to_regclass('public.conversation_members_one_owner'))
        = 'CREATE UNIQUE INDEX conversation_members_one_owner ON public.conversation_members USING btree (conversation_id) WHERE (role = ''owner''::text)',
      false
    ),
    'actual: ' || coalesce(pg_get_indexdef(to_regclass('public.conversation_members_one_owner')), 'none')
  union all
  -- Removal rows disappear with their user, and on purpose not with their conversation.
  select
    'conversation_removals has exactly one foreign key: profiles, cascade',
    coalesce((
      select count(*) = 1 and bool_and(k.confrelid = to_regclass('public.profiles') and k.confdeltype = 'c')
      from pg_catalog.pg_constraint k
      where k.conrelid = to_regclass('public.conversation_removals') and k.contype = 'f'
    ), false),
    null
  union all
  select
    'primary key conversation_removals (user_id, conversation_id)',
    coalesce(
      pg_get_indexdef(to_regclass('public.conversation_removals_pkey'))
        = 'CREATE UNIQUE INDEX conversation_removals_pkey ON public.conversation_removals USING btree (user_id, conversation_id)',
      false
    ),
    'actual: ' || coalesce(pg_get_indexdef(to_regclass('public.conversation_removals_pkey')), 'none')
  union all
  -- The group functions still contain the conditions the security model relies on.
  select
    'function body: ' || frag.signature || ' ' || frag.label,
    coalesce((
      select position(frag.needle in p.prosrc) > 0
      from pg_catalog.pg_proc p
      where p.oid = to_regprocedure(frag.signature)
    ), false),
    null
  from (
    values
      ('private.guard_message_update()', 'refuses changes to system messages',
        'if old.kind = ''system'' then'),
      ('private.validate_message_attachment()', 'skips text and system messages',
        'if new.kind in (''text'', ''system'') then'),
      ('private.member_since(uuid)', 'reads the caller''s own membership',
        'and m.user_id = (select auth.uid())'),
      ('private.can_read_attachment(text)', 'only messages sent since the caller joined',
        'and msg.created_at >= m.joined_at'),
      ('private.lock_group(uuid)', 'requires a signed-in caller',
        'errcode = ''42501'''),
      ('private.lock_group(uuid)', 'locks groups only',
        E'and c.type = ''group''\n  for update'),
      ('private.lock_group(uuid)', 'same error for not a member and not found',
        'errcode = ''P0002'''),
      ('public.rename_group(uuid, text)', 'locks the group',
        'perform private.lock_group(p_conversation_id)'),
      ('public.add_group_members(uuid, uuid[])', 'locks the group',
        'perform private.lock_group(p_conversation_id)'),
      ('public.add_group_members(uuid, uuid[])', 'allows 50 members at most',
        ') > 50 then'),
      ('public.add_group_members(uuid, uuid[])', 'refuses a full group with CS002',
        'errcode = ''CS002'''),
      ('public.remove_group_member(uuid, uuid)', 'owner only',
        'if private.lock_group(p_conversation_id) <> ''owner'' then'),
      ('public.remove_group_member(uuid, uuid)', 'tells the removed member',
        'values (p_user_id, p_conversation_id)'),
      ('public.transfer_group_ownership(uuid, uuid)', 'owner only',
        'if private.lock_group(p_conversation_id) <> ''owner'' then'),
      ('public.leave_group(uuid)', 'locks the group',
        'v_role text := private.lock_group(p_conversation_id)'),
      ('public.leave_group(uuid)', 'hands the group to the member who joined first',
        'order by m.joined_at, m.user_id')
  ) as frag (signature, label, needle)
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
