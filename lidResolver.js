/**
 * واتساب دلوقتي بيستخدم نظام "LID" (رقم بديل) بدل الرقم الحقيقي أحياناً في
 * بعض الجروبات، عشان يخفي رقم التليفون الحقيقي. ده معناه إن رسالة نفس
 * الشخص ممكن توصلنا برقم مختلف تماماً عن رقمه الحقيقي المكتوب في config.js.
 *
 * الملف ده بيحاول يلاقي رقم الـ LID المقابل لرقم تليفون حقيقي عن طريق
 * sock.onWhatsApp، وبيخزن النتيجة (cache) عشان منعملش الطلب ده كل رسالة.
 */

const cache = new Map(); // رقم حقيقي -> رقم LID (أو null لو مقدرناش نلاقيه)

function numberOf(jid) {
  if (!jid) return null;
  return String(jid).split("@")[0].split(":")[0].replace(/\D/g, "");
}

async function resolveLid(sock, phoneNumber) {
  const num = numberOf(phoneNumber);
  if (!num) return null;
  if (cache.has(num)) return cache.get(num);

  try {
    const results = await sock.onWhatsApp(num);
    const lidJid = results?.[0]?.lid;
    const lidNum = lidJid ? numberOf(lidJid) : null;
    cache.set(num, lidNum);
    return lidNum;
  } catch (e) {
    cache.set(num, null);
    return null;
  }
}

module.exports = { resolveLid, numberOf };
