/**
 * رسايل مجدولة (تتبعت تلقائي كل يوم في وقت معين) لكل جروب. بتتخزن في ملف
 * scheduled_messages.json عشان تفضل موجودة حتى لو البوت اتقفل وتشغل تاني.
 * شكل الملف: { [groupId]: [{ time: "HH:MM", text, lastSentDate }] }
 *
 * ملحوظة: الوقت بيتقارن بتوقيت الجهاز اللي شغال عليه البوت (توقيت السيرفر/الموبايل).
 */

const fs = require("fs");
const path = require("path");

const FILE_PATH = path.join(__dirname, "scheduled_messages.json");
const CHECK_INTERVAL_MS = 30 * 1000; // بيفحص كل 30 ثانية

function loadSchedules() {
  try {
    if (fs.existsSync(FILE_PATH)) {
      const raw = fs.readFileSync(FILE_PATH, "utf8");
      const obj = JSON.parse(raw);
      if (obj && typeof obj === "object") return obj;
    }
  } catch (e) {
    console.error("مقدرتش أقرا ملف الرسايل المجدولة (scheduled_messages.json):", e.message);
  }
  return {};
}

let schedules = loadSchedules();

function saveToDisk() {
  try {
    fs.writeFileSync(FILE_PATH, JSON.stringify(schedules, null, 2), "utf8");
  } catch (e) {
    console.error("مقدرتش أحفظ ملف الرسايل المجدولة (scheduled_messages.json):", e.message);
  }
}

function isValidTime(time) {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(time);
}

function addSchedule(groupId, time, text) {
  if (!isValidTime(time)) return false;
  if (!schedules[groupId]) schedules[groupId] = [];
  schedules[groupId].push({ time, text, lastSentDate: null });
  saveToDisk();
  return true;
}

function removeSchedule(groupId, index) {
  const list = schedules[groupId] || [];
  if (index < 0 || index >= list.length) return false;
  list.splice(index, 1);
  saveToDisk();
  return true;
}

function listSchedules(groupId) {
  return schedules[groupId] || [];
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function currentHHMM() {
  const d = new Date();
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

// بتتنادى مرة واحدة بس وقت تشغيل البوت - بتفحص كل الجروبات كل 30 ثانية
// وتبعت أي رسالة مجدولة وصل وقتها ولسه ما اتبعتش النهاردة
function startScheduler(sock) {
  setInterval(async () => {
    const now = currentHHMM();
    const today = todayStr();

    for (const groupId of Object.keys(schedules)) {
      const list = schedules[groupId];
      for (const item of list) {
        if (item.time === now && item.lastSentDate !== today) {
          item.lastSentDate = today;
          try {
            await sock.sendMessage(groupId, { text: `⏰ ${item.text}` });
          } catch (e) {
            console.error("خطأ في إرسال رسالة مجدولة:", e.message);
          }
        }
      }
    }
    saveToDisk();
  }, CHECK_INTERVAL_MS);
}

module.exports = { addSchedule, removeSchedule, listSchedules, startScheduler, isValidTime };
