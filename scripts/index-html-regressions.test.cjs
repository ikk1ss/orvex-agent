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

test("balance widget loads real data and does not ship demo numbers", () => {
  assert.ok(html.includes('id="balanceWidget"') && html.includes('id="topupModal"'));
  assert.ok(html.includes("fetch('/api/balance'"));
  const markup = html.slice(html.indexOf('id="balanceWidget"'), html.indexOf('id="balanceWidget"') + 600);
  assert.ok(!/\d{2,}/.test(markup.replace(/id="[^"]*"|aria-[a-z]+="[^"]*"/g, "")), "no hardcoded balance in markup");
  assert.ok(html.includes('id="topupPay" type="button" disabled'), "payment button stays disabled until payments exist");
});

test("authentication methods appear in the requested order", () => {
  const telegram = html.indexOf('id="authTelegram"');
  const google = html.indexOf('id="authGoogle"');
  const guest = html.indexOf('id="authGuest"');
  assert.ok(telegram >= 0 && google > telegram && guest > google);
  assert.ok(html.includes('id="authModal"'));
  assert.ok(html.includes("signInAnonymously()"));
  assert.ok(html.includes("signInWithOAuth"));
  assert.ok(html.includes("is_anonymous"));
  assert.ok(html.includes("fetch('/api/auth-config'"));
});

test("guest chat is connected only to the OpenRouter free router", () => {
  assert.ok(html.includes('id="aiChatForm"'));
  assert.ok(html.includes("model:'openrouter/free'"));
  assert.ok(html.includes("fetch('/api/ai-chat'"));
  assert.ok(html.includes("fetch('/api/guest-quota'"));
  assert.ok(html.includes("guestQuota.remaining>0"));
  assert.ok(html.includes("balanceAdd.disabled=!(telegramMiniApp&&telegramProfileSession)"));
});
