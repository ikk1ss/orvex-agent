const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

test("avatar initials split on whitespace, not on a literal backslash", () => {
  assert.ok(!html.includes("split(/\\\\s+/)"));
  assert.ok(html.includes("split(/\\s+/)"));
});

test("server profile responses never depend on unguarded localStorage writes", () => {
  assert.ok(html.includes("function saveLocal("));
  assert.ok(!/profile=result\.profile\|\|[a-z]+;localStorage\.setItem/.test(html));
  assert.ok(!html.includes("$('#deleteAccount')"));
});
