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
assert(html.includes("id=\"memoryAccountTools\"") && html.includes("id=\"exportAccount\"") && html.includes("id=\"deleteAccount\""), "Account data controls are missing");
assert(html.includes("fetch('/api/account") && html.includes("window.confirm("), "Account export/deletion actions are not wired or deletion confirmation is missing");
assert(html.includes("localStorage.removeItem('orvex_agent_profile')"), "Account deletion does not clear local profile data");


assert(html.includes("viewportChanged"), "Telegram viewport change handling is missing");
assert(html.includes("viewportStableHeight"), "Telegram stable viewport height is not used");
assert(html.includes("telegramBack.onClick(closeModal)"), "Telegram BackButton is not connected to the profile dialog");
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

if (failures.length) {
  console.error("ORVEX Agent validation failed:");
  for (const failure of failures) console.error("- " + failure);
  process.exit(1);
}

console.log("ORVEX Agent validation passed.");
console.log("Checked: " + ids.length + " unique IDs, in-page links, profile controls, Telegram SDK and " + inlineScripts.length + " inline script(s).");

assert(html.includes('id="profileAvatarImage"') && html.includes('id="replayOnboarding"'), "Profile avatar and onboarding replay controls are missing");
assert(html.includes("renderProfileAvatar") && html.includes("telegramAvatarUrl"), "Telegram avatar rendering is not wired");
