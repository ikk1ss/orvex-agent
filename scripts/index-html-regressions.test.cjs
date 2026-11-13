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

test("translation dictionaries do not mix languages", () => {
  const start = html.indexOf("const translations={");
  const end = html.indexOf("const originalTextNodes");
  const translations = new Function(html.slice(start, end).replace(/function isDeletePhrase[\s\S]*$/, "") + "\nreturn translations;")();
  const latin = (v) => /[A-Za-z]/.test(v);
  // English values must not be German-only and vice versa for known markers.
  assert.equal(translations.de["Персональные функции"], "Persönliche Funktionen");
  assert.equal(translations.de["Назад"], "Zurück");
  assert.equal(translations.en["Ваше пространство"], "Your workspace");
  for (const lang of ["en", "de"]) {
    for (const [key, value] of Object.entries(translations[lang])) {
      assert.ok(value.length > 0, `${lang}: empty translation for ${key}`);
    }
  }
  assert.ok(latin(translations.en["Назад"]));
});

test("every Russian UI string used by the script has an English and German translation", () => {
  const start = html.indexOf("const translations={");
  const end = html.indexOf("const originalTextNodes");
  const translations = new Function(html.slice(start, end).replace(/function isDeletePhrase[\s\S]*$/, "") + "\nreturn translations;")();
  const script = html.slice(html.indexOf("<script>"), html.indexOf("const translations={")) +
    html.slice(html.indexOf("const originalTextNodes"), html.indexOf("</script>", html.indexOf("const originalTextNodes")));
  const missing = [];
  for (const m of script.matchAll(/'((?:\\.|[^'\\\n])*[А-Яа-яЁё](?:\\.|[^'\\\n])*)'/g)) {
    const text = m[1];
    if (text.startsWith('<div class="memory-empty">')) continue;
    if (/^(Показано|Память подключена)/.test(text) || text === " Можно загрузить ещё.") continue;
    if (/^(Предпочтение|Факт|Цель|Инструкция|Заметка)$/.test(text)) continue;
    if (["ru-RU", "Русский"].includes(text) || /^(Личный ИИ-помощник|Мой профиль|Начать|Далее|Ваш профиль|Ваше пространство|для|нового интеллекта\.|Назад)$/.test(text)) continue;
    if (!translations.en[text] || !translations.de[text]) missing.push(text);
  }
  assert.deepEqual([...new Set(missing)], []);
});
