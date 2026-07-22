/**
 * لوجر بسيط ومستقل (من غير أي مكتبة خارجية إضافية) بيسجّل أحداث نظام
 * الشات في ملف (chat/data/chat.log) + الكونسول، عشان تقدر تتبع الأخطاء
 * والاستخدام والأداء بسهولة.
 */

const fs = require("fs");
const path = require("path");
const chatConfig = require("./config");

function ensureDataDir() {
  try {
    fs.mkdirSync(chatConfig.DATA_DIR, { recursive: true });
  } catch (e) {
    // لو مقدرش يعمل المجلد، هيكمل بس من غير كتابة على ملف (الكونسول لسه شغال)
    console.error("[شات] مقدرتش أعمل مجلد البيانات:", e.message);
  }
}
ensureDataDir();

let writeQueue = Promise.resolve();
const MAX_LOG_BYTES = 5 * 1024 * 1024; // 5MB - لو الملف كبر أكتر بنعمله تدوير بسيط

function rotateIfNeeded() {
  try {
    if (fs.existsSync(chatConfig.LOG_FILE)) {
      const { size } = fs.statSync(chatConfig.LOG_FILE);
      if (size > MAX_LOG_BYTES) {
        const backupPath = chatConfig.LOG_FILE.replace(/\.log$/, ".old.log");
        fs.renameSync(chatConfig.LOG_FILE, backupPath);
      }
    }
  } catch (e) {
    // تجاهل أي خطأ في التدوير، مش حرج
  }
}

function writeLine(line) {
  // بنسلسل الكتابة عشان منتلخبطش لو حصل أكتر من لوج في نفس اللحظة
  writeQueue = writeQueue
    .then(() => {
      rotateIfNeeded();
      return fs.promises.appendFile(chatConfig.LOG_FILE, line + "\n", "utf8");
    })
    .catch((e) => {
      console.error("[شات] مقدرتش أكتب في ملف اللوج:", e.message);
    });
}

function format(level, message, meta) {
  const entry = {
    time: new Date().toISOString(),
    level,
    message,
    ...(meta ? { meta } : {}),
  };
  return JSON.stringify(entry);
}

function info(message, meta) {
  const line = format("info", message, meta);
  console.log(`[شات] ${message}`, meta ? meta : "");
  writeLine(line);
}

function warn(message, meta) {
  const line = format("warn", message, meta);
  console.warn(`[شات:تحذير] ${message}`, meta ? meta : "");
  writeLine(line);
}

function error(message, meta) {
  const line = format("error", message, meta);
  console.error(`[شات:خطأ] ${message}`, meta ? meta : "");
  writeLine(line);
}

function debug(message, meta) {
  const line = format("debug", message, meta);
  writeLine(line);
}

// لوج مخصص لكل تفاعل مع الذكاء الاصطناعي (سؤال/رد) عشان تتبع سهل للاستخدام والأداء
function logInteraction({ userId, model, persona, promptChars, replyChars, latencyMs, cacheHit, ok }) {
  info("تفاعل شات", {
    userId,
    model,
    persona,
    promptChars,
    replyChars,
    latencyMs,
    cacheHit: !!cacheHit,
    ok,
  });
}

module.exports = { info, warn, error, debug, logInteraction };
