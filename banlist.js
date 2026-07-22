/**
 * قايمة الحظر الدائم - أي رقم هنا لو حاول يدخل أي جروب البوت فيه، هيتطرد
 * أوتوماتيك فورًا. بتتخزن في ملف banned_users.json عشان تفضل موجودة حتى
 * لو البوت اتقفل وتشغل تاني.
 */

const fs = require("fs");
const path = require("path");
const lidResolver = require("./lidResolver");

const FILE_PATH = path.join(__dirname, "banned_users.json");

function numberOf(jid) {
  return lidResolver.numberOf(jid);
}

function loadBanned() {
  try {
    if (fs.existsSync(FILE_PATH)) {
      const raw = fs.readFileSync(FILE_PATH, "utf8");
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return new Set(arr.map(numberOf).filter(Boolean));
    }
  } catch (e) {
    console.error("مقدرتش أقرا ملف الحظر (banned_users.json)، هبدأ بقايمة فاضية:", e.message);
  }
  return new Set();
}

let bannedUsers = loadBanned();

function saveToDisk() {
  try {
    fs.writeFileSync(FILE_PATH, JSON.stringify([...bannedUsers], null, 2), "utf8");
  } catch (e) {
    console.error("مقدرتش أحفظ ملف الحظر (banned_users.json):", e.message);
  }
}

function isBanned(jidOrNumber) {
  const num = numberOf(jidOrNumber) || jidOrNumber;
  return bannedUsers.has(num);
}

function addBan(jid) {
  const num = numberOf(jid);
  if (!num) return false;
  const alreadyThere = bannedUsers.has(num);
  bannedUsers.add(num);
  saveToDisk();
  return !alreadyThere;
}

function removeBan(jid) {
  const num = numberOf(jid);
  if (!num) return false;
  const existed = bannedUsers.has(num);
  bannedUsers.delete(num);
  saveToDisk();
  return existed;
}

function listBanned() {
  return [...bannedUsers];
}

module.exports = { isBanned, addBan, removeBan, listBanned };
