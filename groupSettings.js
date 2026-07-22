/**
 * إعدادات خاصة بكل جروب (بتتخزن في ملف group_settings.json عشان تفضل
 * موجودة حتى لو البوت اتقفل وتشغل تاني). شكل الملف:
 * { [groupId]: { welcomeEnabled: true/false, blockAllLinks: true/false, rules: "نص القوانين" } }
 */

const fs = require("fs");
const path = require("path");

const FILE_PATH = path.join(__dirname, "group_settings.json");

function loadSettings() {
  try {
    if (fs.existsSync(FILE_PATH)) {
      const raw = fs.readFileSync(FILE_PATH, "utf8");
      const obj = JSON.parse(raw);
      if (obj && typeof obj === "object") return obj;
    }
  } catch (e) {
    console.error("مقدرتش أقرا ملف إعدادات الجروبات (group_settings.json):", e.message);
  }
  return {};
}

let settings = loadSettings();

function saveToDisk() {
  try {
    fs.writeFileSync(FILE_PATH, JSON.stringify(settings, null, 2), "utf8");
  } catch (e) {
    console.error("مقدرتش أحفظ ملف إعدادات الجروبات (group_settings.json):", e.message);
  }
}

function getGroup(groupId) {
  if (!settings[groupId]) settings[groupId] = { welcomeEnabled: true, blockAllLinks: true, rules: "" };
  // لو الجروب موجود من قبل بإعدادات قديمة من غير الحقل الجديد، نضيفه بقيمة
  // افتراضية (true) بدل ما يفضل undefined ويتفسر بشكل غلط
  if (settings[groupId].blockAllLinks === undefined) settings[groupId].blockAllLinks = true;
  return settings[groupId];
}

function isWelcomeEnabled(groupId) {
  return getGroup(groupId).welcomeEnabled !== false;
}

function setWelcomeEnabled(groupId, enabled) {
  getGroup(groupId).welcomeEnabled = !!enabled;
  saveToDisk();
}

// لو true: أي رابط (يوتيوب/انستجرام/أي حاجة فيها http أو www) بيتحذف وصاحبه
// بيتطرد فورًا. لو false: بس روابط دعوة جروبات واتساب (chat.whatsapp.com)
// هي اللي بتتحظر، وباقي الروابط مسموحة.
function isBlockAllLinksEnabled(groupId) {
  return getGroup(groupId).blockAllLinks !== false;
}

function setBlockAllLinks(groupId, enabled) {
  getGroup(groupId).blockAllLinks = !!enabled;
  saveToDisk();
}

function getRules(groupId) {
  return getGroup(groupId).rules || "";
}

function setRules(groupId, text) {
  getGroup(groupId).rules = text;
  saveToDisk();
}

module.exports = {
  isWelcomeEnabled,
  setWelcomeEnabled,
  isBlockAllLinksEnabled,
  setBlockAllLinks,
  getRules,
  setRules,
};
