/**
 * عميل التواصل مع Groq (سحابي، مجاني بالكامل) لأمر .شات.
 * بدّلنا Gemini بـ Groq هنا لسببين:
 *   1) Groq أسرع بكتير (بيستخدم LPU مش GPU عادي - رد شبه فوري).
 *   2) حد الطلبات المجاني لـ Gemini كان بس 20 طلب/دقيقة وده قليل جدًا مع
 *      استخدام عادي، وده اللي كان بيسبب رسايل "quota exceeded". Groq
 *      حده المجاني أعلى بكتير (عشرات الطلبات/دقيقة حسب الموديل).
 * نفس مفتاح GROQ_API_KEY المستخدم أصلاً في تفريغ الصوت (downloaders.js).
 */

const fetch = require("node-fetch");
const config = require("../config");
const chatConfig = require("./config");
const logger = require("./logger");

class GroqError extends Error {
  constructor(message, code, retryAfterMs) {
    super(message);
    this.name = "GroqError";
    this.code = code; // "NO_KEY" | "TIMEOUT" | "RATE_LIMIT" | "UNKNOWN"
    this.retryAfterMs = retryAfterMs || null;
  }
}

function withTimeout(promise, ms) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new GroqError("انتهت مهلة انتظار رد الموديل", "TIMEOUT")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

// بيحاول يستخرج عدد الثواني اللي لازم تستناها من رسالة الخطأ (مثلاً
// "Please try again in 1.2s") أو من هيدر retry-after
function extractRetryAfterMs(message, headerValue) {
  if (headerValue && !isNaN(Number(headerValue))) return Number(headerValue) * 1000;
  const match = /try again in ([\d.]+)s/i.exec(message || "");
  if (match) return Math.ceil(parseFloat(match[1]) * 1000);
  return null;
}

// إرسال محادثة كاملة (سياق) لـ Groq واستقبال رد واحد كامل
async function chat({ model, systemPrompt, messages }) {
  if (!config.GROQ_API_KEY) {
    throw new GroqError(
      "محتاج مفتاح Groq المجاني في config.js (GROQ_API_KEY). تقدر تجيبه من هنا: https://console.groq.com/keys",
      "NO_KEY"
    );
  }

  const modelName = model || chatConfig.DEFAULT_MODEL;

  const payload = {
    model: modelName,
    messages: [
      ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
      ...messages,
    ],
    temperature: chatConfig.TEMPERATURE,
    top_p: chatConfig.TOP_P,
    max_tokens: chatConfig.NUM_PREDICT,
  };

  let res, data;
  try {
    res = await withTimeout(
      fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.GROQ_API_KEY}`,
        },
        body: JSON.stringify(payload),
      }),
      chatConfig.REQUEST_TIMEOUT_MS
    );
    data = await res.json();
  } catch (err) {
    if (err instanceof GroqError) throw err;
    throw new GroqError(err.message || "خطأ غير معروف في الاتصال بـ Groq", "UNKNOWN");
  }

  if (res.status === 429 || data?.error?.code === "rate_limit_exceeded") {
    const retryAfterMs = extractRetryAfterMs(data?.error?.message, res.headers?.get?.("retry-after"));
    throw new GroqError(
      data?.error?.message || "تجاوزت حد الطلبات المجاني المسموح به حاليًا.",
      "RATE_LIMIT",
      retryAfterMs
    );
  }

  if (data?.error) {
    logger.error("خطأ من Groq (شات)", { error: data.error });
    throw new GroqError(data.error.message || "Groq رجّع خطأ", "UNKNOWN");
  }

  const content = data?.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new GroqError("الموديل رجّع رد فاضي", "UNKNOWN");
  }
  return { content, raw: data };
}

async function listModels() {
  return chatConfig.AVAILABLE_MODELS;
}

async function isReachable() {
  return !!config.GROQ_API_KEY;
}

module.exports = { chat, listModels, isReachable, GroqError };
