/**
 * حفظ الحالات (status) بتاعة جهات الاتصال اللي بتوصلك وانت أونلاين.
 * ملحوظة: البوت يقدر يشوف بس الحالات اللي أصلاً مسموح ليك تشوفها
 * (يعني اللي معاك في الكونتاكت والشخص مسموحلك تشوف حالاته)، ومينفعش
 * يجيب حالات قديمة فاتت قبل ما البوت يشتغل.
 */

const { savedStatuses } = require("./storage");

const MAX_STORED = 50; // أقصى عدد حالات نحتفظ بيها في نفس الوقت

async function handleStatusMessage(sock, msg) {
  try {
    if (msg.key.remoteJid !== "status@broadcast") return;

    const from = msg.key.participant || msg.key.remoteJid;
    const messageType = Object.keys(msg.message || {})[0];

    let type = null;
    if (messageType === "imageMessage") type = "image";
    if (messageType === "videoMessage") type = "video";
    if (!type) return; // بنتجاهل حالات النص بس

    const buffer = await sock.downloadMediaMessage(msg);
    savedStatuses.push({
      from,
      type,
      buffer,
      caption: msg.message[messageType]?.caption || "",
      time: Date.now(),
    });

    if (savedStatuses.length > MAX_STORED) savedStatuses.shift();
  } catch (err) {
    console.error("خطأ في حفظ الحالة:", err);
  }
}

async function sendSavedStatuses(sock, toJid) {
  if (savedStatuses.length === 0) {
    return sock.sendMessage(toJid, { text: "مفيش حالات محفوظة دلوقتي." });
  }
  for (const status of savedStatuses.slice(-10)) {
    await sock.sendMessage(toJid, {
      [status.type]: status.buffer,
      caption: `من: @${status.from.split("@")[0]}\n${status.caption || ""}`,
      mentions: [status.from],
    });
  }
}

module.exports = { handleStatusMessage, sendSavedStatuses };
