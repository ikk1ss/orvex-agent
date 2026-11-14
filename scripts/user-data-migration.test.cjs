"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const migration = fs.readFileSync(path.join(__dirname, "../supabase/migrations/20261114_add_external_auth_user_data.sql"), "utf8");

test("external auth data is owned by Supabase Auth UUIDs", () => {
  assert.match(migration, /orvex_auth_profiles\s*\([\s\S]*?user_id uuid primary key references auth\.users\(id\) on delete cascade/i);
  assert.match(migration, /orvex_auth_chat_messages\s*\([\s\S]*?user_id uuid not null references auth\.users\(id\) on delete cascade/i);
});
test("external auth tables enable RLS and deny direct browser-role access", () => {
  for (const table of ["orvex_auth_profiles", "orvex_auth_chat_messages"]) {
    assert.match(migration, new RegExp("alter table public\\." + table + " enable row level security", "i"));
    assert.match(migration, new RegExp("revoke all on table public\\." + table + " from public, anon, authenticated", "i"));
  }
  assert.match(migration, /grant select, insert, update, delete on table public\.orvex_auth_profiles to service_role/i);
  assert.match(migration, /grant select, insert, delete on table public\.orvex_auth_chat_messages to service_role/i);
});
