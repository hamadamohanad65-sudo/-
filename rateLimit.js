/**
 * Rate Limiter بسيط بنظام "نافذة منزلقة" (sliding window) لكل مستخدم على حدة.
 * بيمنع أي مستخدم إنه يسأل الشات عدد كبير جدًا من المرات في وقت قصير عشان
 * يحمي أداء البوت والموديل المحلي من الإغراق.
 */

const chatConfig = require("./config");

const hits = new Map(); // userId -> [timestamps]

function check(userId) {
  const now = Date.now();
  const windowStart = now - chatConfig.RATE_LIMIT_WINDOW_MS;

  const list = (hits.get(userId) || []).filter((t) => t > windowStart);

  if (list.length >= chatConfig.RATE_LIMIT_MAX_REQUESTS) {
    const oldestInWindow = list[0];
    const retryAfterMs = oldestInWindow + chatConfig.RATE_LIMIT_WINDOW_MS - now;
    hits.set(userId, list);
    return { allowed: false, retryAfterMs: Math.max(retryAfterMs, 1000) };
  }

  list.push(now);
  hits.set(userId, list);
  return { allowed: true, remaining: chatConfig.RATE_LIMIT_MAX_REQUESTS - list.length };
}

// تنضيف دوري بسيط عشان الـ Map متكبرش على الفاضي لمستخدمين مش نشطين
setInterval(() => {
  const cutoff = Date.now() - chatConfig.RATE_LIMIT_WINDOW_MS;
  for (const [userId, list] of hits.entries()) {
    const fresh = list.filter((t) => t > cutoff);
    if (fresh.length === 0) hits.delete(userId);
    else hits.set(userId, fresh);
  }
}, 5 * 60 * 1000).unref();

module.exports = { check };
