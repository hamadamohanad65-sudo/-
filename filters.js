const config = require("./config");
const groupSettings = require("./groupSettings");

// رابط دعوة جروب واتساب تحديداً
const WA_INVITE_REGEX = /(chat\.whatsapp\.com\/|wa\.me\/)/i;
// أي رابط عادي (لو الحظر الشامل شغال في الجروب ده أو BLOCK_ALL_LINKS الافتراضية شغالة)
const ANY_LINK_REGEX = /(https?:\/\/|www\.)/i;

// لو معدّى groupId: بيتحقق من إعداد الجروب نفسه (قابل للتغيير بأمر
// "حظر_الروابط تشغيل/تعطيل"). لو من غير groupId (استخدام قديم): بيرجع
// لقيمة config.BLOCK_ALL_LINKS الافتراضية.
function isBlockedLink(text, groupId) {
  if (!text) return false;
  const blockAll = groupId ? groupSettings.isBlockAllLinksEnabled(groupId) : config.BLOCK_ALL_LINKS;
  if (blockAll) {
    return ANY_LINK_REGEX.test(text) || WA_INVITE_REGEX.test(text);
  }
  return WA_INVITE_REGEX.test(text);
}

function isContactMessage(messageType) {
  return messageType === "contactMessage" || messageType === "contactsArrayMessage";
}

// بيكشف لو الرسالة معاد توجيهها (Forward) - بيدور على contextInfo جوه أي
// نوع رسالة (نص، صورة، فيديو...) لأن كل نوع بيحطها في مكان مختلف شوية
function isForwarded(msg) {
  if (!msg?.message) return false;
  for (const key of Object.keys(msg.message)) {
    const part = msg.message[key];
    const ctx = part?.contextInfo;
    if (ctx && (ctx.isForwarded || (ctx.forwardingScore || 0) > 0)) {
      return true;
    }
  }
  return false;
}

// -------- كشف رسايل "كراش/تفجير" مشبوهة --------
// دي حماية دفاعية بس: بتكتشف الأنماط المعروفة اللي بتتسبب في تعليق واتساب
// أو تحميل زيادة على الجروب (نص طويل جدًا، منشنات كتير أوي، أو تكرار غريب
// لرموز يونيكود خفية/تحكم) - مش تحليل أو بناء للهجوم نفسه.
const MAX_TEXT_LENGTH = 4000; // أطول بكتير من أي رسالة طبيعية
const MAX_MENTIONS = 20; // تاج بومبينج

// رموز يونيكود شائعة الاستخدام في هجمات التنسيق (zero-width, RTL/LTR override, إلخ)
const HIDDEN_UNICODE_REGEX = /[\u200B-\u200F\u202A-\u202E\uFEFF]/g;
const HIDDEN_UNICODE_THRESHOLD = 50; // تكرار عالي جدًا = مشبوه، مش استخدام عادي

// حدود عامة إضافية على شكل/حجم الرسالة ككل (بغض النظر عن نوعها) - حماية
// احترازية عامة مش موجهة لنمط هجوم معين، بتلقط أي payload مشوه بشكل عام
const MAX_MESSAGE_BYTES = 100_000; // حجم الرسالة الكلي بعد التحويل لنص
const MAX_NESTING_DEPTH = 12; // عمق تداخل غير طبيعي جوه بنية الرسالة
const MAX_STRING_FIELD_LENGTH = 20_000; // أطول قيمة نصية منفردة جوه أي حقل

function getObjectDepth(obj, currentDepth = 0) {
  if (currentDepth > MAX_NESTING_DEPTH + 5) return currentDepth; // وقف مبكر للأداء
  if (obj === null || typeof obj !== "object") return currentDepth;
  let maxChildDepth = currentDepth;
  for (const key of Object.keys(obj)) {
    const childDepth = getObjectDepth(obj[key], currentDepth + 1);
    if (childDepth > maxChildDepth) maxChildDepth = childDepth;
  }
  return maxChildDepth;
}

function getLongestStringFieldLength(obj, depth = 0) {
  if (depth > MAX_NESTING_DEPTH || obj === null || typeof obj !== "object") return 0;
  let longest = 0;
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (typeof val === "string") {
      if (val.length > longest) longest = val.length;
    } else if (typeof val === "object" && val !== null) {
      const childLongest = getLongestStringFieldLength(val, depth + 1);
      if (childLongest > longest) longest = childLongest;
    }
  }
  return longest;
}

function isSuspiciousPayload(msg, textBody) {
  if (textBody && textBody.length > MAX_TEXT_LENGTH) return true;

  const mentions = msg?.message?.extendedTextMessage?.contextInfo?.mentionedJid;
  if (Array.isArray(mentions) && mentions.length > MAX_MENTIONS) return true;

  if (textBody) {
    const hiddenMatches = textBody.match(HIDDEN_UNICODE_REGEX);
    if (hiddenMatches && hiddenMatches.length > HIDDEN_UNICODE_THRESHOLD) return true;
  }

  // فحص عام إضافي على بنية الرسالة كلها (يغطي أنواع رسايل تانية غير النص:
  // مواقع، جهات اتصال، استفتاءات، إلخ اللي ممكن تتبعت بشكل مشوه)
  try {
    if (msg?.message) {
      const serialized = JSON.stringify(msg.message);
      if (serialized.length > MAX_MESSAGE_BYTES) return true;
      if (getObjectDepth(msg.message) > MAX_NESTING_DEPTH) return true;
      if (getLongestStringFieldLength(msg.message) > MAX_STRING_FIELD_LENGTH) return true;
    }
  } catch (e) {
    // لو فشل تحليل بنية الرسالة نفسها، اعتبرها مشبوهة كإجراء احترازي
    return true;
  }

  return false;
}

module.exports = { isBlockedLink, isContactMessage, isForwarded, isSuspiciousPayload };
