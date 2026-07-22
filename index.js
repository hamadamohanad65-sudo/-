/**
 * chat/index.js - نقطة الدخول الرئيسية لنظام "شات". ده اللي بيستخدمه commands.js
 * وبيربط كل الوحدات ببعض: الذاكرة، الشخصيات، الطابور، الكاش، الحد من
 * الاستخدام، اللوجينج، عميل Groq، تقسيم الردود، وتوليد الصور.
 */

const chatConfig = require("./config");
const memory = require("./memory");
const personas = require("./personas");
const { chatQueue } = require("./queue");
const { chatCache, buildKey } = require("./cache");
const rateLimit = require("./rateLimit");
const logger = require("./logger");
const groq = require("./groqClient");
const { splitMessage } = require("./textSplitter");
const imageGen = require("./imageGen");

const BOOT_TIME = Date.now();

function formatRetryAfter(ms) {
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) return `${seconds} ثانية`;
  return `${Math.ceil(seconds / 60)} دقيقة`;
}

// بيبعت رد طويل مقسّم لأجزاء بتأخير بسيط بينهم عشان يوصلوا بترتيبهم
async function sendChunkedReply(sock, groupId, text, mentions) {
  const chunks = splitMessage(text, chatConfig.MAX_MESSAGE_CHARS);
  for (let i = 0; i < chunks.length; i++) {
    const prefix = chunks.length > 1 ? `*(${i + 1}/${chunks.length})*\n` : "";
    await sock.sendMessage(groupId, { text: prefix + chunks[i], ...(mentions ? { mentions } : {}) });
    if (i < chunks.length - 1) {
      await new Promise((r) => setTimeout(r, chatConfig.CHUNK_DELAY_MS));
    }
  }
}

// ================= السؤال الأساسي (.شات) =================
async function askChat({ userId, prompt, sock, groupId }) {
  const rl = rateLimit.check(userId);
  if (!rl.allowed) {
    await sock.sendMessage(groupId, {
      text: `⏳ استنى شوية قبل ما تسأل تاني، حاول بعد ${formatRetryAfter(rl.retryAfterMs)}.`,
    });
    return { ok: false, reason: "RATE_LIMITED" };
  }

  if (chatQueue.isFull()) {
    await sock.sendMessage(groupId, {
      text: "🚦 الطابور مزحوم دلوقتي، جرب تاني كمان شوية.",
    });
    return { ok: false, reason: "QUEUE_FULL" };
  }

  const personaName = memory.getPersona(userId);
  const persona = personas.getPersona(personaName) || personas.getPersona(chatConfig.DEFAULT_PERSONA);
  const model = memory.getModel(userId);
  const history = memory.getTrimmedHistory(userId);

  const cacheKey = chatConfig.CACHE_ENABLED
    ? buildKey({
        model,
        persona: personaName,
        prompt,
        contextTail: history.slice(-2).map((m) => m.content).join("|"),
      })
    : null;

  if (cacheKey) {
    const cached = chatCache.get(cacheKey);
    if (cached) {
      memory.pushTurn(userId, prompt, cached);
      await sendChunkedReply(sock, groupId, cached);
      logger.logInteraction({
        userId,
        model,
        persona: personaName,
        promptChars: prompt.length,
        replyChars: cached.length,
        latencyMs: 0,
        cacheHit: true,
        ok: true,
      });
      return { ok: true, reply: cached, cached: true };
    }
  }

  const startedAt = Date.now();

  try {
    const result = await chatQueue.enqueue(() =>
      groq.chat({
        model,
        systemPrompt: persona.systemPrompt,
        messages: [...history.map((m) => ({ role: m.role, content: m.content })), { role: "user", content: prompt }],
      })
    );

    const latencyMs = Date.now() - startedAt;
    memory.pushTurn(userId, prompt, result.content);
    if (cacheKey) chatCache.set(cacheKey, result.content);

    await sendChunkedReply(sock, groupId, result.content);

    logger.logInteraction({
      userId,
      model,
      persona: personaName,
      promptChars: prompt.length,
      replyChars: result.content.length,
      latencyMs,
      cacheHit: false,
      ok: true,
    });

    return { ok: true, reply: result.content };
  } catch (err) {
    const latencyMs = Date.now() - startedAt;
    logger.error("فشل طلب الشات", { userId, model, error: err.message, code: err.code });
    logger.logInteraction({
      userId,
      model,
      persona: personaName,
      promptChars: prompt.length,
      replyChars: 0,
      latencyMs,
      cacheHit: false,
      ok: false,
    });

    let userMessage = "❌ حصل خطأ في الشات، جرب تاني كمان شوية.";
    if (err.message === "QUEUE_FULL") {
      userMessage = "🚦 الطابور مزحوم دلوقتي، جرب تاني كمان شوية.";
    } else if (err.code === "NO_KEY") {
      userMessage = `❌ ${err.message}`;
    } else if (err.code === "TIMEOUT") {
      userMessage = "⏳ الموديل استغرق وقت طويل أوي في الرد، جرب سؤال أقصر أو جرب تاني.";
    } else if (err.code === "RATE_LIMIT") {
      const wait = err.retryAfterMs ? ` (استنى حوالي ${formatRetryAfter(err.retryAfterMs)})` : "";
      userMessage = `🚦 وصلنا لحد الطلبات المجاني المسموح حاليًا${wait}. جرب تاني بعد شوية.`;
    }

    await sock.sendMessage(groupId, { text: userMessage });
    return { ok: false, reason: err.code || "UNKNOWN" };
  }
}

// ================= إعادة الشات (تاريخ + شخصية + موديل للافتراضي) =================
function resetChat(userId) {
  memory.resetUser(userId);
}

// ================= مسح تاريخ المحادثة بس =================
function clearChat(userId) {
  memory.clearHistory(userId);
}

// ================= تغيير/عرض الشخصية =================
function setPersona(userId, requestedName) {
  if (!requestedName) {
    const current = memory.getPersona(userId);
    const list = personas
      .listPersonaNames()
      .map((name) => `${name === current ? "▸" : "•"} ${personas.getPersona(name).label} — \`${name}\``)
      .join("\n");
    return { ok: true, message: `الشخصية الحالية: *${personas.getPersona(current).label}*\n\nالشخصيات المتاحة:\n${list}` };
  }

  if (!personas.isValidPersona(requestedName)) {
    const list = personas.listPersonaNames().join("، ");
    return { ok: false, message: `❌ الشخصية دي مش موجودة. الشخصيات المتاحة: ${list}` };
  }

  memory.setPersona(userId, requestedName);
  return { ok: true, message: `✅ تم تغيير الشخصية إلى *${personas.getPersona(requestedName).label}*` };
}

// ================= معلومات الشات (.معلومات_الشات) =================
function getChatInfo(userId) {
  const stats = memory.getUserStats(userId);
  const global = memory.getGlobalStats();
  const persona = personas.getPersona(stats.persona);

  return (
    `🤖 *معلومات الشات*\n` +
    `━━━━━━━━━━━━━━━\n` +
    `▸ الموديل الحالي: \`${stats.model}\`\n` +
    `▸ الشخصية الحالية: ${persona ? persona.label : stats.persona}\n` +
    `▸ عدد الأدوار المحفوظة في سياقك: ${stats.historyTurns}\n` +
    `▸ إجمالي رسايلك مع الشات: ${stats.totalMessages}\n` +
    `▸ أول استخدام: ${new Date(stats.firstSeen).toLocaleString("ar-EG")}\n` +
    `▸ آخر استخدام: ${new Date(stats.lastSeen).toLocaleString("ar-EG")}\n\n` +
    `📊 *إحصائيات عامة*\n` +
    `▸ عدد المستخدمين اللي استخدموا الشات: ${global.totalUsers}\n` +
    `▸ إجمالي الرسايل على مستوى البوت: ${global.totalMessages}`
  );
}

// ================= حالة الشات (.حالة_الشات) =================
async function getChatStatus() {
  const uptimeMs = Date.now() - BOOT_TIME;
  const uptimeMin = Math.floor(uptimeMs / 60000);

  const hasKey = await groq.isReachable();
  const groqStatus = hasKey ? "✅ متصل ومفعّل (Groq)" : "❌ محتاج GROQ_API_KEY في config.js";

  return (
    `📡 *حالة نظام الشات*\n` +
    `━━━━━━━━━━━━━━━\n` +
    `▸ محرك الذكاء الاصطناعي: ${groqStatus}\n` +
    `▸ الموديل الافتراضي: \`${chatConfig.DEFAULT_MODEL}\`\n` +
    `▸ حالة الطابور: ${chatQueue.running} شغالة الآن / ${chatQueue.size()} منتظرة\n` +
    `▸ حجم الكاش الحالي: ${chatCache.size()} عنصر\n` +
    `▸ توليد الصور: ${chatConfig.IMAGE.ENABLED ? "✅ مفعّل" : "⏸️ مش مفعّل"}\n` +
    `▸ مدة تشغيل نظام الشات: ${uptimeMin} دقيقة`
  );
}

// ================= توليد صورة محليًا (.صورة_شات) =================
async function generateChatImage({ userId, prompt, sock, groupId }) {
  const rl = rateLimit.check(userId);
  if (!rl.allowed) {
    await sock.sendMessage(groupId, {
      text: `⏳ استنى شوية قبل ما تطلب صورة تانية، حاول بعد ${formatRetryAfter(rl.retryAfterMs)}.`,
    });
    return { ok: false, reason: "RATE_LIMITED" };
  }

  try {
    const buffer = await chatQueue.enqueue(() => imageGen.generateImage(prompt));
    await sock.sendMessage(groupId, { image: buffer, caption: `🎨 ${prompt}` });
    logger.info("تم توليد صورة محليًا", { userId, promptChars: prompt.length });
    return { ok: true };
  } catch (err) {
    logger.error("فشل توليد صورة", { userId, error: err.message, code: err.code });
    let userMessage = `❌ حصل خطأ في توليد الصورة:\n${err.message}`;
    if (err.code === "DISABLED") userMessage = `⏸️ ${err.message}`;
    else if (err.code === "TIMEOUT") userMessage = "⏳ توليد الصورة استغرق وقت طويل أوي، جرب تاني.";
    await sock.sendMessage(groupId, { text: userMessage });
    return { ok: false, reason: err.code || "UNKNOWN" };
  }
}

module.exports = {
  askChat,
  resetChat,
  clearChat,
  setPersona,
  getChatInfo,
  getChatStatus,
  generateChatImage,
};
