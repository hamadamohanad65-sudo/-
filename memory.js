/**
 * ذاكرة سياق المحادثة لكل مستخدم على حدة (مش لكل جروب)، عشان لو نفس الشخص
 * كلم الشات من أكتر من جروب يفضل سياقه واحد. بتتحفظ في ملف
 * chat/data/memory.json عشان تفضل موجودة حتى لو البوت اتقفل وتشغل تاني.
 */

const fs = require("fs");
const chatConfig = require("./config");
const personas = require("./personas");
const logger = require("./logger");

function ensureDataDir() {
  try {
    fs.mkdirSync(chatConfig.DATA_DIR, { recursive: true });
  } catch (e) {
    logger.error("مقدرتش أعمل مجلد بيانات الشات", { error: e.message });
  }
}
ensureDataDir();

function loadMemory() {
  try {
    if (fs.existsSync(chatConfig.MEMORY_FILE)) {
      const raw = fs.readFileSync(chatConfig.MEMORY_FILE, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed;
    }
  } catch (e) {
    logger.error("مقدرتش أقرا ملف ذاكرة الشات، هبدأ ببيانات فاضية", { error: e.message });
  }
  return {};
}

// الشكل: { [userId]: { persona, model, messages: [{role, content, ts}], stats: {...}, createdAt, updatedAt } }
const memory = loadMemory();

let saveTimer = null;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.writeFileSync(chatConfig.MEMORY_FILE, JSON.stringify(memory, null, 2), "utf8");
    } catch (e) {
      logger.error("مقدرتش أحفظ ملف ذاكرة الشات", { error: e.message });
    }
  }, chatConfig.MEMORY_SAVE_DEBOUNCE_MS);
}

function ensureUser(userId) {
  if (!memory[userId]) {
    memory[userId] = {
      persona: chatConfig.DEFAULT_PERSONA,
      model: null, // null يعني "استخدم الموديل الافتراضي الحالي"
      messages: [],
      stats: { totalMessages: 0, firstSeen: Date.now(), lastSeen: Date.now() },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }
  return memory[userId];
}

function getHistory(userId) {
  return ensureUser(userId).messages;
}

// بيرجع تاريخ محادثة "مقصوص" حسب حد الأدوار وحد الحروف اللي في الإعدادات،
// عشان مانبعتش سياق كبير أوي للموديل (بيبطئ الرد ويزود استهلاك الذاكرة)
function getTrimmedHistory(userId) {
  const user = ensureUser(userId);
  const maxEntries = chatConfig.MAX_HISTORY_TURNS * 2;
  let trimmed = user.messages.slice(-maxEntries);

  let totalChars = trimmed.reduce((sum, m) => sum + m.content.length, 0);
  while (totalChars > chatConfig.MAX_HISTORY_CHARS && trimmed.length > 2) {
    const removed = trimmed.shift();
    totalChars -= removed.content.length;
  }
  return trimmed;
}

function pushTurn(userId, userText, botText) {
  const user = ensureUser(userId);
  const now = Date.now();
  user.messages.push({ role: "user", content: userText, ts: now });
  user.messages.push({ role: "assistant", content: botText, ts: now });

  const maxEntries = chatConfig.MAX_HISTORY_TURNS * 2;
  if (user.messages.length > maxEntries) {
    user.messages = user.messages.slice(-maxEntries);
  }

  user.stats.totalMessages += 1;
  user.stats.lastSeen = now;
  user.updatedAt = now;
  scheduleSave();
}

// بيمسح تاريخ المحادثة بس (بيحافظ على الشخصية والموديل المختارين)
function clearHistory(userId) {
  const user = ensureUser(userId);
  user.messages = [];
  user.updatedAt = Date.now();
  scheduleSave();
}

// إعادة تعيين كاملة: تاريخ + شخصية + موديل يرجعوا للافتراضي (بداية جديدة تمامًا)
function resetUser(userId) {
  memory[userId] = {
    persona: chatConfig.DEFAULT_PERSONA,
    model: null,
    messages: [],
    stats: { totalMessages: 0, firstSeen: Date.now(), lastSeen: Date.now() },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  scheduleSave();
}

function getPersona(userId) {
  return ensureUser(userId).persona || chatConfig.DEFAULT_PERSONA;
}

function setPersona(userId, personaName) {
  const user = ensureUser(userId);
  user.persona = personaName;
  user.updatedAt = Date.now();
  scheduleSave();
}

function getModel(userId) {
  return ensureUser(userId).model || chatConfig.DEFAULT_MODEL;
}

function setModel(userId, model) {
  const user = ensureUser(userId);
  user.model = model;
  user.updatedAt = Date.now();
  scheduleSave();
}

function getUserStats(userId) {
  const user = ensureUser(userId);
  return {
    persona: user.persona,
    model: user.model || chatConfig.DEFAULT_MODEL,
    historyTurns: Math.floor(user.messages.length / 2),
    totalMessages: user.stats.totalMessages,
    firstSeen: user.stats.firstSeen,
    lastSeen: user.stats.lastSeen,
  };
}

function getGlobalStats() {
  const userIds = Object.keys(memory);
  const totalMessages = userIds.reduce((sum, id) => sum + (memory[id].stats?.totalMessages || 0), 0);
  return {
    totalUsers: userIds.length,
    totalMessages,
  };
}

module.exports = {
  getHistory,
  getTrimmedHistory,
  pushTurn,
  clearHistory,
  resetUser,
  getPersona,
  setPersona,
  getModel,
  setModel,
  getUserStats,
  getGlobalStats,
};
