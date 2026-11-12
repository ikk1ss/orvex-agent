import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const failures = [];
const assert = (condition, message) => {
  if (!condition) failures.push(message);
};

assert(/^<!doctype html>/i.test(html.trimStart()), "Missing HTML5 doctype");
assert(/<html\b[^>]*lang=["']ru["']/i.test(html), "Document language should be Russian");
assert(/<meta\b[^>]*name=["']viewport["']/i.test(html), "Missing viewport meta tag");
assert(html.includes("https://telegram.org/js/telegram-web-app.js"), "Telegram WebApp SDK is not included");
assert(html.includes("/api/health") && html.includes("/api/session"), "Backend health and Telegram session checks are missing");
assert(html.includes('id="memory"') && html.includes('id="memoryForm"') && html.includes('id="memoryList"'), "Personal memory workspace elements are missing");
assert(html.includes("initMemoryWorkspace") && html.includes("fetch('/api/memory"), "Personal memory API integration is missing");
assert(html.includes("textContent=item.content"), "Memory content must be rendered as text, not HTML");
assert(html.includes("encodeURIComponent(item.id)"), "Memory deletion ID is not URL-encoded");
assert(html.includes('id="memoryLoadMore"') && html.includes("memoryOffset+=data.memories.length") && html.includes("pagination&&data.pagination.hasMore"), "Personal memory pagination is missing");
assert(html.includes('id="memoryAccountTools"') && html.includes('id="exportAccount"'), "Account export controls are missing");
assert(html.includes('id="logoutAccount"') && html.includes('id="openDeleteConfirm"'), "Separate logout and account deletion controls are missing");
assert(html.includes('id="profileLanguage"') && html.includes('type="hidden" name="language"') && !html.includes('id="applyLanguage"') && html.includes("document.documentElement.lang=activeInterfaceLanguage"), "Language preference must remain stored without a profile-level language control");
assert(html.includes('class="language-menu"') && html.includes('id="languageCurrent"') && html.includes('id="languageOptions"') && html.includes('id="languageOptions" role="group"') && html.includes('data-language="ru"') && html.includes('data-language="en"') && html.includes('data-language="de"'), "Compact current-language menu with expandable language options is missing");
assert(html.includes("button.dataset.language===activeInterfaceLanguage") && html.includes("button.addEventListener('click',async()=>"), "Header language buttons are not connected to language selection");
assert(html.includes("languageCurrent.addEventListener('click'") && html.includes("languageOptions.hidden=expanded") && html.includes("languageOptions.hidden=true;languageCurrent.setAttribute('aria-expanded','false')"), "Language menu must expand on demand and close after selection or outside click");
assert(html.includes("function canonicalTranslation(value)") && html.includes("state.lastApplied"), "Language switching must preserve canonical text when dynamic content changes");
assert(html.includes("function renderHeroHeading()") && html.includes("heading.replaceChildren") && html.includes("renderHeroHeading();"), "Hero heading must be rendered as one complete translation for each interface language");
assert(html.includes("['Your workspace','for','a new kind of intelligence.']") && html.includes("['Ihr Arbeitsbereich','für','eine neue Art von Intelligenz.']"), "Hero heading must have complete English and German translations");
assert(html.includes("new MutationObserver(records=>") && html.includes("record.addedNodes.forEach(translateSubtree)") && html.includes("record.type==='characterData'"), "Dynamically inserted or updated interface text is not translated");
assert(html.includes("'Добро пожаловать':'Welcome'") && html.includes("'Добро пожаловать':'Willkommen'"), "The onboarding greeting must be translated in English and German");
assert(html.includes("--accent-cyan:#72d8d0") && html.includes("--accent-violet:#a996ff"), "The refreshed cyan and violet design palette is missing");
assert(html.includes("backdrop-filter:none;-webkit-backdrop-filter:none"), "Mobile transparency effects must be reduced for performance");
assert(html.includes('id="deleteConfirmModal"') && html.includes("deleteConfirmStep===1") && html.includes("deletePhrase.value.trim().toLocaleUpperCase('ru')!=='УДАЛИТЬ'"), "Two-step account deletion confirmation is missing");
assert(html.includes("fetch('/api/account',{method:'DELETE'") && html.includes("tg.close()"), "Account deletion or app exit action is not wired");
assert(!html.includes('id="deleteAccount"') && !html.includes("window.confirm('Удалить профиль"), "Old combined memory deletion control or one-step confirmation remains");

assert(html.includes("localStorage.removeItem('orvex_agent_profile')"), "Account deletion does not clear local profile data");
assert(html.includes("setProfileStatus('Профиль не создан'") && html.includes("updateHeaderAction();") && html.includes("openOnboarding();"), "Account deletion must reset profile UI and return the user to onboarding");


assert(html.includes("viewportChanged"), "Telegram viewport change handling is missing");
assert(html.includes("viewportStableHeight"), "Telegram stable viewport height is not used");
assert(html.includes("telegramBack.onClick(()=>onboarding.classList.contains('open')?closeOnboarding():closeModal())"), "Telegram BackButton must close the onboarding or profile dialog");
assert(html.includes("telegramBack.show()") && html.includes("telegramBack.hide()"), "Telegram BackButton visibility is not managed");

const ids = [...html.matchAll(/\bid=["']([^"']+)["']/g)].map((match) => match[1]);
const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
assert(duplicateIds.length === 0, "Duplicate element IDs: " + [...new Set(duplicateIds)].join(", "));

const idSet = new Set(ids);
const missingAnchors = [...html.matchAll(/href="#([^"]+)"/g)]
  .map((match) => match[1])
  .filter((id) => !idSet.has(id));
assert(missingAnchors.length === 0, "Broken in-page links: " + missingAnchors.join(", "));

for (const required of ["profileOpen", "heroProfile", "profileClose", "profileForm", "profileModal"]) {
  assert(idSet.has(required), "Missing required profile element: #" + required);
}

const inlineScripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
  .filter((match) => !/\bsrc\s*=/.test(match[1]))
  .map((match) => match[2])
  .filter((source) => source.trim());

assert(inlineScripts.length > 0, "No inline application script found");
for (let index = 0; index < inlineScripts.length; index += 1) {
  try {
    new vm.Script(inlineScripts[index], { filename: "inline-script-" + (index + 1) + ".js" });
  } catch (error) {
    failures.push("Inline JavaScript " + (index + 1) + " has a syntax error: " + error.message);
  }
}

assert(html.includes("orvex_agent_profile"), "Local profile storage key is missing");
assert(html.includes("localStorage.setItem"), "Profile save logic is missing");
assert(html.includes("localStorage.getItem"), "Profile load logic is missing");
assert(html.includes("savedProfile.name.trim()"), "Saved profile data is not validated before use");
assert(html.includes("localStorage.removeItem('orvex_agent_profile')"), "Invalid saved profile data is not cleared");
assert(html.includes("lastFocusedElement.focus()"), "Profile dialog does not restore keyboard focus after closing");
assert(html.includes("modal.querySelectorAll('button:not([disabled])"), "Profile dialog keyboard focus trap is missing");
assert(html.includes("form.elements.consent.checked"), "Profile consent is not checked before saving");
assert(html.includes("const profileStorageNote=$('.local-note')"), "Profile storage status note is not connected to runtime state");
assert(html.includes("Серверное хранение профиля пока недоступно"), "Telegram profile must not claim server storage before backend setup");
assert(html.includes("Локальная копия не считается серверным сохранением"), "Local profile cache must not be presented as server persistence");
assert(html.includes("Профиль синхронизирован с сервером ORVEX Agent."), "Successful server profile state is not described");

assert(html.includes('aria-hidden="true"') && html.includes("setAttribute('aria-hidden','false')"), "Profile dialog accessibility state is missing");

assert(html.includes('id="profileAvatarImage"') && html.includes('id="replayOnboarding"'), "Profile avatar and onboarding replay controls are missing");
assert(html.includes('class="profile-account-section"') && html.includes('class="profile-account-section danger"'), "Logout and deletion actions must be visually separated");
assert(html.includes("localStorage.setItem('orvex_agent_language',language)") && html.includes("applyInterfaceLanguage(language)"), "Selected interface language is not saved and applied");
assert(html.includes("Type УДАЛИТЬ to confirm") && html.includes("Geben Sie УДАЛИТЬ zur Bestätigung ein"), "Deletion phrase must remain consistent across supported languages");
assert(html.includes("renderProfileAvatar") && html.includes("telegramAvatarUrl"), "Telegram avatar rendering is not wired");

if (failures.length) {
  console.error("ORVEX Agent validation failed:");
  for (const failure of failures) console.error("- " + failure);
  process.exit(1);
}

console.log("ORVEX Agent validation passed.");
console.log("Checked: " + ids.length + " unique IDs, in-page links, profile controls, Telegram SDK and " + inlineScripts.length + " inline script(s).");

