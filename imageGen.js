/**
 * توليد الصور لأمر .صورة_شات - بيستخدم Pollinations.ai (مجاني بالكامل،
 * من غير أي مفتاح API أو فوترة خالص). بدّلنا بيها Gemini image بعد ما
 * تأكدنا إن موديلات الصور عند جوجل بتاخد "limit: 0" على الفري تير العادي
 * (محتاجة فوترة مفعّلة حتى لو الاستخدام نفسه هيفضل تحت الحد المجاني).
 */

const fetch = require("node-fetch");
const chatConfig = require("./config");
const logger = require("./logger");
const groq = require("./groqClient");
const rootConfig = require("../config");

class ImageGenError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "ImageGenError";
    this.code = code; // "DISABLED" | "TIMEOUT" | "UNKNOWN"
  }
}

function withTimeout(promise, ms) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new ImageGenError("انتهت مهلة توليد الصورة", "TIMEOUT")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

// بيحوّل وصف المستخدم (غالبًا عربي أو مختصر) لبرومبت إنجليزي مفصّل بيفهمه
// موديل الصور (Flux) صح. من غير الخطوة دي، البرومبت العربي أو المختصر
// بيدّي نتايج عشوائية/غلط لأن موديلات الصور اتدربت أساسًا على وصف إنجليزي.
// بيستخدم نفس Groq المستخدم في الشات، ولو فشل (مفيش مفتاح/تايم اوت) بيرجع
// البرومبت الأصلي زي ما هو عشان الصورة تتعمل برضه بدل ما توقف كليًا.
async function enhancePrompt(rawPrompt) {
  try {
    const { content } = await groq.chat({
      model: chatConfig.DEFAULT_MODEL,
      systemPrompt:
        "You are a prompt writer for an AI image generation model (Flux/Stable Diffusion). " +
        "The user gives you an image request, often in Arabic, Arabic-English mix, or very short. " +
        "Rewrite it into ONE detailed, vivid English prompt the image model can render accurately. " +
        "Rules: " +
        "1) Stay 100% faithful to the subject and scene the user asked for — never add, remove, or change the main subject, count, or action. " +
        "2) Translate any Arabic to natural English. " +
        "3) Add concrete visual detail that improves rendering accuracy: subject description, setting, lighting, camera/art style, composition, and positive quality tags (e.g. 'highly detailed, sharp focus, professional, correct anatomy, symmetrical, clean composition, 4k'). " +
        "4) If the request implies people or animals, explicitly describe correct proportions/anatomy and natural pose to reduce common AI rendering mistakes. " +
        "5) Keep it to 1-3 sentences, comma-separated descriptive phrases work well. " +
        "6) Output ONLY the final prompt text — no quotes, no labels, no explanation, no markdown.",
      messages: [{ role: "user", content: rawPrompt }],
    });
    const cleaned = (content || "").replace(/^["'“”]+|["'“”]+$/g, "").trim();
    return cleaned || rawPrompt;
  } catch (err) {
    logger.error("فشل تحسين برومبت الصورة، هيتبعت البرومبت الأصلي", { error: err.message });
    return rawPrompt;
  }
}

async function generateImage(prompt) {
  if (!chatConfig.IMAGE.ENABLED) {
    throw new ImageGenError("توليد الصور لسه مش مفعّل (chat/config.js -> IMAGE.ENABLED).", "DISABLED");
  }

  const finalPrompt = await enhancePrompt(prompt);
  const MAX_ATTEMPTS = 3;
  let lastErr;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      // seed عشوائي عشان كل محاولة تجيب صورة مختلفة (سواء نفس البرومبت أو
      // بعد فشل محاولة قبلها)
      const seed = Math.floor(Math.random() * 1_000_000);
      const url =
        `https://image.pollinations.ai/prompt/${encodeURIComponent(finalPrompt)}` +
        `?width=1024&height=1024&seed=${seed}&nologo=true&model=flux&enhance=true` +
        (rootConfig.POLLINATIONS_API_KEY ? `&key=${encodeURIComponent(rootConfig.POLLINATIONS_API_KEY)}` : "");

      const res = await withTimeout(fetch(url), chatConfig.IMAGE.REQUEST_TIMEOUT_MS);

      if (res.status === 429) {
        // اتجاوزنا حد الطلبات المجاني (المستخدمين من غير مفتاح مسموحلهم
        // بطلب كل 15 ثانية بس) - نستنى شوية ونعيد المحاولة بدل ما نفشل فورًا
        logger.error("Pollinations رجّع 429 (تجاوز حد الطلبات)، هنستنى ونعيد المحاولة", { attempt });
        lastErr = new ImageGenError("السيرفر مزحوم دلوقتي، جرب تاني كمان شوية.", "UNKNOWN");
        if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, 4000 * attempt));
        continue;
      }

      if (!res.ok) {
        const bodyText = await res.text().catch(() => "");
        logger.error("خطأ HTTP من Pollinations (توليد صورة شات)", { status: res.status, body: bodyText.slice(0, 300), attempt });
        lastErr = new ImageGenError(`السيرفر رجّع خطأ (كود ${res.status})، جرب تاني كمان شوية.`, "UNKNOWN");
        if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, 1500));
        continue;
      }

      const buffer = Buffer.from(await res.arrayBuffer());
      if (!buffer || buffer.length < 500) {
        logger.error("Pollinations رجّع بيانات مش صورة سليمة", { size: buffer?.length, attempt });
        lastErr = new ImageGenError("السيرفر رجّع بيانات مش صورة، جرب وصف تاني.", "UNKNOWN");
        if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, 1500));
        continue;
      }

      return buffer;
    } catch (err) {
      lastErr = err instanceof ImageGenError ? err : new ImageGenError(`حصل خطأ غير متوقع في توليد الصورة: ${err.message}`, "UNKNOWN");
      logger.error("خطأ في توليد الصورة", { error: err.message, attempt });
      if (attempt < MAX_ATTEMPTS && lastErr.code !== "TIMEOUT") {
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
  }

  throw lastErr || new ImageGenError("مقدرتش أعمل الصورة بعد كذا محاولة.", "UNKNOWN");
}

module.exports = { generateImage, enhancePrompt, ImageGenError };
