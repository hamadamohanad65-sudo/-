/**
 * تخزين مشترك في الذاكرة (يتصفر لو البوت اتقفل وتشغل تاني)
 * كل الكائنات هنا شكلها: { groupId: { userId: ... } }
 */

const fs = require("fs");
const path = require("path");
const config = require("./config");

const STATS_FILE = path.join(__dirname, "stats.json");

const warnings = {}; // عدد التحذيرات
const spamTracker = {}; // توقيتات آخر رسايل لفلتر السبام
const messageCount = {}; // عداد رسايل كل شخص (بالجلسة الحالية بس - كاش سريع للإحصائيات)
const lastActive = {}; // آخر وقت نشاط لكل شخص (لطرد الخاملين)

// ================= إحصائيات دائمة (بتتحفظ في stats.json) =================
// شكل البيانات: { groupId: { userId: { total, firstSeen, daily: { "YYYY-MM-DD": count } } } }
function loadStats() {
  try {
    if (fs.existsSync(STATS_FILE)) {
      const raw = fs.readFileSync(STATS_FILE, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed;
    }
  } catch (e) {
    console.error("مقدرتش أقرا ملف الإحصائيات (stats.json)، هبدأ ببيانات فاضية:", e.message);
  }
  return {};
}

const persistentStats = loadStats();
let saveStatsTimer = null;

// حفظ مع تأخير بسيط (debounce) عشان منكتبش على الملف مع كل رسالة رسالة
function scheduleStatsSave() {
  if (saveStatsTimer) return;
  saveStatsTimer = setTimeout(() => {
    saveStatsTimer = null;
    try {
      fs.writeFileSync(STATS_FILE, JSON.stringify(persistentStats, null, 2), "utf8");
    } catch (e) {
      console.error("مقدرتش أحفظ ملف الإحصائيات (stats.json):", e.message);
    }
  }, 3000);
}

function todayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function ensureUserStats(groupId, userId) {
  if (!persistentStats[groupId]) persistentStats[groupId] = {};
  if (!persistentStats[groupId][userId]) {
    persistentStats[groupId][userId] = { total: 0, firstSeen: Date.now(), daily: {} };
  }
  return persistentStats[groupId][userId];
}

// مجموع الرسايل في آخر N يوم (شامل النهاردة)
function getPeriodCount(groupId, userId, days) {
  const userStats = persistentStats[groupId]?.[userId];
  if (!userStats) return 0;
  let sum = 0;
  const now = new Date();
  for (let i = 0; i < days; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    sum += userStats.daily[todayKey(d)] || 0;
  }
  return sum;
}

// إحصائيات شاملة لشخص: الإجمالي، ترتيبه، متوسطه اليومي، ومدة نشاطه
function getFullUserStats(groupId, userId) {
  const groupStats = persistentStats[groupId] || {};
  const userStats = groupStats[userId];
  if (!userStats) return null;

  const ranked = Object.entries(groupStats).sort((a, b) => b[1].total - a[1].total);
  const rank = ranked.findIndex(([id]) => id === userId) + 1;

  const activeDaysCount = Object.keys(userStats.daily).length || 1;
  const average = Math.round((userStats.total / activeDaysCount) * 10) / 10;

  const durationMs = Date.now() - userStats.firstSeen;
  const durationDays = Math.max(1, Math.floor(durationMs / (24 * 60 * 60 * 1000)));

  return {
    total: userStats.total,
    rank,
    totalMembers: ranked.length,
    average,
    durationDays,
  };
}

// ترتيب كل أعضاء الجروب حسب الإجمالي المحفوظ (دائم، مش بس الجلسة الحالية)
function getFullLeaderboard(groupId) {
  const groupStats = persistentStats[groupId] || {};
  return Object.entries(groupStats)
    .map(([id, s]) => [id, s.total])
    .sort((a, b) => b[1] - a[1]);
}
const activeGames = {}; // حالة الألعاب الشغالة لكل جروب
const savedStatuses = []; // الحالات المحفوظة { from, type, buffer, caption, time }
const groupMetaCache = {}; // كاش بيانات الجروب (participants..) عشان نسرّع الرد { groupId: { data, time } }
const activeLocks = {}; // دالة إلغاء العداد الحي لقفل الجروب المؤقت الشغال حاليًا { groupId: cancelFn }
// ملاحظة: ذاكرة الشات الذكي بقت لكل مستخدم (مش لكل جروب) وبتتحفظ على القرص،
// اتنقلت بالكامل لمجلد chat/ (شوف chat/memory.js).
const activePolls = {}; // التصويتات الشغالة لكل جروب { groupId: { question, options, votes: { userId: optionIndex } } }
// recentMedia بقى Map (recentMediaMap) تحت - شوف قسم "منع تكرار نفس الفيديو" تحت

function getWarnCount(groupId, userId) {
  if (!warnings[groupId]) warnings[groupId] = {};
  return warnings[groupId][userId] || 0;
}

function addWarn(groupId, userId) {
  if (!warnings[groupId]) warnings[groupId] = {};
  warnings[groupId][userId] = (warnings[groupId][userId] || 0) + 1;
  return warnings[groupId][userId];
}

function resetWarn(groupId, userId) {
  if (warnings[groupId]) warnings[groupId][userId] = 0;
}

function isSpamming(groupId, userId) {
  const now = Date.now();
  if (!spamTracker[groupId]) spamTracker[groupId] = {};
  if (!spamTracker[groupId][userId]) spamTracker[groupId][userId] = [];

  spamTracker[groupId][userId] = spamTracker[groupId][userId].filter(
    (t) => now - t < config.SPAM_TIME_WINDOW_MS
  );
  spamTracker[groupId][userId].push(now);

  if (spamTracker[groupId][userId].length > config.SPAM_MSG_LIMIT) {
    spamTracker[groupId][userId] = [];
    return true;
  }
  return false;
}

function trackActivity(groupId, userId) {
  if (!lastActive[groupId]) lastActive[groupId] = {};
  lastActive[groupId][userId] = Date.now();

  if (!messageCount[groupId]) messageCount[groupId] = {};
  messageCount[groupId][userId] = (messageCount[groupId][userId] || 0) + 1;

  // تحديث الإحصائيات الدائمة (يومي + إجمالي) وجدولة الحفظ على القرص
  const userStats = ensureUserStats(groupId, userId);
  userStats.total += 1;
  const key = todayKey();
  userStats.daily[key] = (userStats.daily[key] || 0) + 1;
  scheduleStatsSave();
}

// ================= تصويت/استفتاء =================
function startPoll(groupId, question, options) {
  activePolls[groupId] = { question, options, votes: {} };
}

function hasActivePoll(groupId) {
  return !!activePolls[groupId];
}

function castVote(groupId, userId, optionIndex) {
  const poll = activePolls[groupId];
  if (!poll) return false;
  if (optionIndex < 0 || optionIndex >= poll.options.length) return false;
  poll.votes[userId] = optionIndex;
  return true;
}

function getPollResults(groupId) {
  const poll = activePolls[groupId];
  if (!poll) return null;
  const counts = poll.options.map(() => 0);
  Object.values(poll.votes).forEach((idx) => counts[idx]++);
  return { question: poll.question, options: poll.options, counts };
}

function endPoll(groupId) {
  const results = getPollResults(groupId);
  delete activePolls[groupId];
  return results;
}

// ================= منع تكرار نفس الفيديو لنفس الطلب =================
// ملحوظة مهمة (كانت هنا مشكلة تسريب ذاكرة): كل استعلام (query) مختلف كان بيعمل
// مفتاح جديد في recentMedia ومكانش بينمسح أبدًا، حتى لو محدش استخدمه تاني. مع
// الوقت (خصوصًا مع أمر تيك اللي بيتستخدم كتير بأسماء مختلفة كل مرة) كان عدد
// المفاتيح بيكبر من غير حد أقصى لحد ما الذاكرة تخلص. الحل: نحول recentMedia
// لـ Map (بيحافظ على ترتيب الإدخال) ونحط حد أقصى لعدد المفاتيح الكلي، ولما
// نعديه نمسح أقدم مفتاح (LRU) تلقائيًا.
const RECENT_MEDIA_MAX = 8; // أقصى عدد فيديوهات نفتكرها لكل مفتاح
const RECENT_MEDIA_MAX_KEYS = 500; // أقصى عدد مفاتيح (طلبات مختلفة) نفتكرها كلها مع بعض

const recentMediaMap = new Map(); // نفس فكرة recentMedia بس بـ Map عشان الـ LRU

function recentMediaKey(groupId, type, query) {
  return `${groupId}::${type}::${(query || "").trim().toLowerCase()}`;
}

function touchRecentMediaKey(key) {
  // نشيل المفتاح ونرجع نحطه، عشان يبقى "الأحدث استخدامًا" في ترتيب الـ Map
  const value = recentMediaMap.get(key);
  if (value) {
    recentMediaMap.delete(key);
    recentMediaMap.set(key, value);
  }
  return value;
}

function wasRecentlySent(groupId, type, query, id) {
  const key = recentMediaKey(groupId, type, query);
  const list = touchRecentMediaKey(key);
  return (list || []).includes(id);
}

function markAsSent(groupId, type, query, id) {
  const key = recentMediaKey(groupId, type, query);
  let list = touchRecentMediaKey(key);
  if (!list) {
    list = [];
    recentMediaMap.set(key, list);
  }
  list.push(id);
  if (list.length > RECENT_MEDIA_MAX) list.shift();

  // لو عدد المفاتيح زاد عن الحد، امسح الأقدم استخدامًا (أول عنصر في الـ Map)
  while (recentMediaMap.size > RECENT_MEDIA_MAX_KEYS) {
    const oldestKey = recentMediaMap.keys().next().value;
    recentMediaMap.delete(oldestKey);
  }
}

module.exports = {
  warnings,
  spamTracker,
  messageCount,
  lastActive,
  activeGames,
  savedStatuses,
  groupMetaCache,
  activeLocks,
  activePolls,
  recentMedia: recentMediaMap,
  getWarnCount,
  addWarn,
  resetWarn,
  isSpamming,
  trackActivity,
  startPoll,
  hasActivePoll,
  castVote,
  getPollResults,
  endPoll,
  wasRecentlySent,
  markAsSent,
  getPeriodCount,
  getFullUserStats,
  getFullLeaderboard,
};
