/**
 * إدارة قايمة الأشخاص المسموح لهم يستخدموا أوامر البوت.
 * القايمة دي بتتخزن في ملف allowed_users.json عشان تفضل موجودة حتى لو
 * البوت اتقفل وتشغل تاني (على عكس باقي بيانات storage.js اللي بتتصفر).
 *
 * أول مرة تشغل فيها البوت (قبل ما يتعمل الملف)، بيبدأ بالقايمة الموجودة
 * في config.js (ALLOWED_USERS) كنقطة بداية بس.
 */

const fs = require("fs");
const path = require("path");
const config = require("./config");
const lidResolver = require("./lidResolver");

const FILE_PATH = path.join(__dirname, "allowed_users.json");

function numberOf(jid) {
  return lidResolver.numberOf(jid);
}

function loadAllowedUsers() {
  try {
    if (fs.existsSync(FILE_PATH)) {
      const raw = fs.readFileSync(FILE_PATH, "utf8");
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return new Set(arr.map(numberOf).filter(Boolean));
    }
  } catch (e) {
    console.error("مقدرتش أقرا ملف الصلاحيات (allowed_users.json)، هبدأ بقايمة فاضية:", e.message);
  }
  // مفيش ملف لسه - نبدأ بالقايمة الافتراضية المكتوبة في config.js
  return new Set((config.ALLOWED_USERS || []).map(numberOf).filter(Boolean));
}

let allowedUsers = loadAllowedUsers();

function saveToDisk() {
  try {
    fs.writeFileSync(FILE_PATH, JSON.stringify([...allowedUsers], null, 2), "utf8");
  } catch (e) {
    console.error("مقدرتش أحفظ ملف الصلاحيات (allowed_users.json):", e.message);
  }
}

// بيتأكد هل الرقم/الـ JID ده هو صاحب البوت - بيقارن بالرقم الحقيقي وبرقم
// الـ LID المقابل له كمان (نظام واتساب الجديد ممكن يبعت الرسالة برقم مختلف)
async function isOwner(sock, jidOrNumber) {
  const num = numberOf(jidOrNumber) || jidOrNumber;
  const ownerNum = numberOf(config.OWNER_NUMBER);
  if (num === ownerNum) return true;

  const ownerLid = await lidResolver.resolveLid(sock, config.OWNER_NUMBER);
  return !!ownerLid && num === ownerLid;
}

// بيتأكد هل الرقم/الـ JID ده مسموح له يستخدم أوامر البوت (صاحب البوت مسموح له دايماً)
async function isAllowed(sock, jidOrNumber) {
  const num = numberOf(jidOrNumber) || jidOrNumber;

  if (await isOwner(sock, num)) return true;
  if (allowedUsers.has(num)) return true;

  // نطابق كمان عن طريق LID لكل رقم في القايمة (لو الرسالة جاية برقم LID)
  for (const allowedNum of allowedUsers) {
    const lid = await lidResolver.resolveLid(sock, allowedNum);
    if (lid && num === lid) return true;
  }
  return false;
}

function addAllowed(jid) {
  const num = numberOf(jid);
  if (!num) return false;
  const alreadyThere = allowedUsers.has(num);
  allowedUsers.add(num);
  saveToDisk();
  return !alreadyThere; // بيرجع true لو ده إضافة جديدة فعلاً
}

function removeAllowed(jid) {
  const num = numberOf(jid);
  if (!num) return false;
  const existed = allowedUsers.has(num);
  allowedUsers.delete(num);
  saveToDisk();
  return existed;
}

function listAllowed() {
  return [...allowedUsers];
}

// بيتأكد هل الرقم/الـ JID ده رقم محمي (صاحب البوت أو أي بوت تاني في OTHER_BOT_NUMBERS)
// بيقارن بالرقم الحقيقي وبرقم الـ LID المقابل له كمان (زي isOwner بالظبط)
async function isProtectedNumber(sock, jidOrNumber) {
  if (await isOwner(sock, jidOrNumber)) return true;

  const num = numberOf(jidOrNumber) || jidOrNumber;
  for (const protectedRaw of config.OTHER_BOT_NUMBERS || []) {
    const protNum = numberOf(protectedRaw);
    if (num === protNum) return true;
    const lid = await lidResolver.resolveLid(sock, protectedRaw);
    if (lid && num === lid) return true;
  }
  return false;
}

module.exports = { isOwner, isAllowed, addAllowed, removeAllowed, listAllowed, numberOf, isProtectedNumber };
