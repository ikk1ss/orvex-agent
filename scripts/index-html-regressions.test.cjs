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
  const translations = new Function(html.slice(start, end) + "\nreturn translations;")();
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
  const translations = new Function(html.slice(start, end) + "\nreturn translations;")();
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

test("authentication options display a matching app icon on the left", () => {
  const telegram = html.slice(html.indexOf('id="authTelegram"'), html.indexOf('id="authGoogle"'));
  const google = html.slice(html.indexOf('id="authGoogle"'), html.indexOf('id="authGuest"'));
  const guest = html.slice(html.indexOf('id="authGuest"'), html.indexOf('</div>', html.indexOf('id="authGuest"')));
  for (const button of [telegram, google, guest]) {
    assert.ok(button.includes('class="auth-method-icon"'));
    assert.ok(button.includes('<svg'));
    assert.ok(button.includes('</svg>'));
    assert.ok(button.includes('<span>'));
  }
  assert.ok(google.includes('fill="#EA4335"'), "Google button uses the Google brand mark");
});

test("external auth refresh keeps the latest token and clears chat on identity changes", () => {
  assert.ok(html.includes("supabaseClient.auth.onAuthStateChange("));
  assert.ok(html.includes("externalAuthSession=session||null"));
  assert.ok(html.includes("const identityChanged=Boolean(observedAuthUserId&&nextUserId!==observedAuthUserId)"));
  assert.ok(html.includes("chatHistoryLoadedFor=''"));
  assert.ok(html.includes("guestQuotaReady=false"));
});

test("guest chat is connected only to the OpenRouter free router", () => {
  assert.ok(html.includes('id="aiChatForm"'));
  assert.ok(html.includes("model:'openrouter/free'"));
  assert.ok(html.includes("fetch('/api/ai-chat'"));
  assert.ok(html.includes("fetch('/api/guest-quota'"));
  assert.ok(html.includes("guestQuota.remaining>0"));
  assert.ok(html.includes("authGoogleButton.disabled=!supabaseClient||telegramMiniApp"));
  assert.ok(html.includes("authGuestButton.disabled=!supabaseClient||telegramMiniApp"));
  assert.ok(html.includes("balanceAdd.disabled=!(telegramMiniApp&&telegramProfileSession)"));
});


test("onboarding and status copy describe the current AI and sign-in features", () => {
  const markup = html.slice(html.indexOf("</head>"), html.indexOf("<script>"));
  assert.ok(markup.includes("AI-чат уже подключён через OpenRouter."));
  assert.ok(html.includes("openrouter/free"));
  assert.ok(markup.includes("Порядок входа: Telegram, Google, затем гостевой режим."));
  assert.ok(markup.includes("20 запросов в сутки"));
  assert.ok(!markup.includes("реальные AI-запросы и выбор моделей в интерфейсе ещё не подключены"));
  assert.ok(!markup.includes("История этого чата хранится только до перезагрузки страницы"));
});

test("profile copy distinguishes external account storage from local-only mode", () => {
  assert.ok(html.includes("Профиль и история чата сохраняются в вашем аккаунте ORVEX Agent."));
  assert.ok(html.includes("Без входа профиль сохраняется только на этом устройстве."));
  assert.ok(html.includes("Серверное хранилище аккаунта недоступно."));
});

test("late chat, history, and quota responses are ignored after account changes", () => {
  assert.ok(html.includes("authGeneration++"));
  assert.ok(html.includes("requestGeneration!==authGeneration"));
  assert.ok(html.includes("historyGeneration!==authGeneration"));
  assert.ok(html.includes("quotaGeneration!==authGeneration"));
});


test("onboarding and sign-in dialogs support keyboard focus trapping and Escape", () => {
  assert.ok(html.includes("onboarding.querySelectorAll('button:not([disabled])"));
  assert.ok(html.includes("authModal.querySelectorAll('button:not([disabled])"));
  assert.ok(html.includes("if(e.key==='Escape'){closeOnboarding();return}"));
  assert.ok(html.includes("if(e.key==='Escape'){closeAuthModal();return}"));
  assert.ok(html.includes("onboardingNextButton.focus()"));
});

test("mobile dialogs respect device safe areas and short Telegram viewports", () => {
  assert.ok(html.includes("env(safe-area-inset-top)"));
  assert.ok(html.includes("var(--tg-viewport-height,100dvh)"));
  assert.ok(html.includes(".auth-panel,.delete-confirm-card"));
  assert.ok(html.includes("@media(max-width:370px)"));
});


test("browser guests do not see Telegram-only balance and account deletion controls", () => {
  assert.ok(html.includes('id="balanceWidget" aria-live="polite" hidden'));
  assert.ok(html.includes('id="telegramDeleteSection" hidden'));
  assert.ok(html.includes("deleteSection.hidden=!canUseTelegramAccount"));
  assert.ok(html.includes("balanceWidget.hidden=!canUseTelegramAccount"));
  assert.ok(html.includes("balanceAdd.disabled=!(telegramMiniApp&&telegramProfileSession)"));
});


test("profile language sync cannot overwrite a newly selected account", () => {
  assert.ok(html.includes("languageGeneration=authGeneration"));
  assert.ok(html.includes("languageGeneration!==authGeneration"));
  assert.ok(html.includes("languageUserId=externalAuthSession.user&&externalAuthSession.user.id"));
});


test("the roadmap lists all seven phases in the agreed order", () => {
  const roadmapStart = html.indexOf('<section class="roadmap" id="roadmap">');
  const roadmapEnd = html.indexOf("</section>", roadmapStart);
  const roadmap = html.slice(roadmapStart, roadmapEnd);
  const stages = [...roadmap.matchAll(/roadmap-num">([0-9]{2})/g)].map(match => match[1]);
  assert.deepEqual(stages, ["01", "02", "03", "04", "05", "06", "07"]);
  assert.ok(roadmap.indexOf("Основной Telegram-бот") < roadmap.indexOf("Бот поддержки"));
  assert.ok(roadmap.indexOf("Бот поддержки") < roadmap.indexOf("Административная панель"));
  assert.ok(roadmap.includes("Финальный этап"));
});


test("Telegram Back closes the topmost account deletion confirmation", () => {
  assert.ok(html.includes("else if(deleteModal.classList.contains('open'))closeDeleteConfirmation()"));
});


test("guest onboarding explains the non-recoverable anonymous session", () => {
  assert.ok(html.includes("Гостевой аккаунт не восстанавливается после выхода или очистки данных браузера."));
  assert.ok(html.includes("После настройки сервера используйте Google для сохранения истории между устройствами."));
});


test("the interface provides a keyboard skip link to the main content", () => {
  assert.ok(html.includes('class="skip-link" href="#home"'));
  assert.ok(html.includes('<main class="wrap" id="home" tabindex="-1">'));
  assert.ok(html.includes("Перейти к содержимому"));
});
