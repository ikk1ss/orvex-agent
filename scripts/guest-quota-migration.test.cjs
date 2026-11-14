"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const sql = fs.readFileSync(path.join(__dirname, "..", "supabase", "migrations", "20261114_add_orvex_guest_usage_quota.sql"), "utf8");

test("guest quota is capped at 20 and uses UTC calendar days", () => {
  assert.match(sql, /request_count between 0 and 20/i);
  assert.match(sql, /request_count < 20/i);
  assert.match(sql, /case when p_consume then v_count <= 20 else v_count < 20 end/i);
  assert.match(sql, /now\(\) at time zone 'UTC'/i);
  assert.match(sql, /\(v_usage_date \+ 1\)::timestamp at time zone 'UTC'/i);
});

test("guest usage data is isolated from browser roles", () => {
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /revoke all on table public\.orvex_guest_usage from public, anon, authenticated/i);
  assert.match(sql, /revoke all on function public\.orvex_guest_quota\(uuid, boolean\) from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.orvex_guest_quota\(uuid, boolean\) to service_role/i);
});

test("guest usage rows are deleted with their Supabase Auth user", () => {
  assert.match(sql, /references auth\.users\(id\) on delete cascade/i);
});
