# Supabase schema snapshot (metadata only)

Project: Orvex  
Project ref: `ccvrlaywxudmgoleyjpx`  
Region: `eu-west-1`  
PostgreSQL: `17.11.0.018`  
Snapshot date: 2026-11-15

This file records the live public-schema inventory queried from Supabase. It contains no row data, credentials, tokens, or connection strings. It is a structural reference, not a complete `pg_dump` and cannot by itself restore the database.

## Applied migrations

- `20261112053012_create_orvex_profile_and_memory_schema`
- `20261112072939_add_orvex_profile_preferences`
- `20261113140505_add_orvex_chat_messages_and_lock_down_access`
- `20261113140525_add_service_role_policies_for_orvex_data`

## Live public tables and columns

### `public.orvex_profiles`

| Column | Type | Nullable | Default |
|---|---|---:|---|
| telegram_id | text | no | |
| display_name | text | no | |
| email | text | no | `''::text` |
| interest | text | no | |
| updated_at | timestamptz | no | `now()` |
| preferences | jsonb | no | `'{}'::jsonb` |

### `public.orvex_memories`

| Column | Type | Nullable | Default |
|---|---|---:|---|
| id | uuid | no | `gen_random_uuid()` |
| telegram_id | text | no | |
| content | text | no | |
| category | text | no | `'note'::text` |
| created_at | timestamptz | no | `now()` |

### `public.orvex_chat_messages`

| Column | Type | Nullable | Default |
|---|---|---:|---|
| id | uuid | no | `gen_random_uuid()` |
| telegram_id | text | no | |
| role | text | no | |
| content | text | no | |
| created_at | timestamptz | no | `now()` |

## Row-level security policies

The following policies were returned by `pg_policies`:

| Table | Policy | Role | Command |
|---|---|---|---|
| orvex_profiles | orvex_profiles_service_role_only | service_role | ALL |
| orvex_memories | orvex_memories_service_role_only | service_role | ALL |
| orvex_chat_messages | orvex_chat_messages_service_role_only | service_role | ALL |

## Not included

- Table row data, including user profiles, memories, and chat messages
- Supabase Auth users and identity data
- Storage objects
- Secrets, API keys, JWT secrets, passwords, and connection strings
- Full function, trigger, index, constraint, and grant DDL

## Restore note

Use this inventory together with the versioned SQL migrations in the repository when reconstructing the schema. Do not treat this file as a complete database backup. A full backup including data must be exported separately and stored in a private, encrypted location, not this public repository.
