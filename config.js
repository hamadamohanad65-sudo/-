/**
 * إعدادات نظام "شات" - بيستخدم Groq (سحابي، مجاني بالكامل، من غير بطاقة
 * ائتمان). محتاج بس مفتاح GROQ_API_KEY في config.js الرئيسي (نفس المفتاح
 * المستخدم في تفريغ الصوت). Groq بيستخدم LPU مش GPU عادي، فبيرد شبه فوري،
 * وحده المجاني للطلبات أعلى بكتير من Gemini (اللي كان بيدينا "quota
 * exceeded" بسرعة مع 20 طلب/دقيقة بس).
 *
 * لو محتاج مفتاح جديد: https://console.groq.com/keys (مجاني تمامًا)
 */

const path = require("path");

module.exports = {
  // مهلة انتظار رد الموديل (بالميلي ثانية) قبل ما نعتبره فشل.
  REQUEST_TIMEOUT_MS: 20000,

  // ------------- الموديل -------------
  // llama-3.3-70b-versatile: أقوى وأدق، لسه سريع جدًا مع Groq.
  // لو عايز أسرع من كده على حساب دقة بسيطة، جرب llama-3.1-8b-instant.
  DEFAULT_MODEL: "llama-3.3-70b-versatile",
  AVAILABLE_MODELS: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"],

  // إعدادات توليد النص
  TEMPERATURE: 0.7,
  TOP_P: 0.9,
  NUM_PREDICT: 1024,

  // ------------- الذاكرة/السياق -------------
  MAX_HISTORY_TURNS: 12,
  MAX_HISTORY_CHARS: 12000,

  // ------------- الطابور (Queue) -------------
  QUEUE_CONCURRENCY: 3,
  QUEUE_MAX_SIZE: 60,

  // ------------- الكاش -------------
  CACHE_ENABLED: true,
  CACHE_TTL_MS: 10 * 60 * 1000,
  CACHE_MAX_ENTRIES: 300,

  // ------------- الحد من الاستخدام (Rate Limit) -------------
  RATE_LIMIT_MAX_REQUESTS: 8,
  RATE_LIMIT_WINDOW_MS: 60 * 1000,

  // ------------- تقسيم الردود الطويلة -------------
  MAX_MESSAGE_CHARS: 3500,
  CHUNK_DELAY_MS: 700,

  // ------------- الشخصيات (.شخصية) -------------
  DEFAULT_PERSONA: "افتراضية",

  // ------------- التخزين -------------
  DATA_DIR: path.join(__dirname, "data"),
  MEMORY_FILE: path.join(__dirname, "data", "memory.json"),
  LOG_FILE: path.join(__dirname, "data", "chat.log"),
  MEMORY_SAVE_DEBOUNCE_MS: 2000,

  // ------------- توليد الصور (.صورة_شات) -------------
  // Pollinations.ai - مجاني بالكامل، من غير أي مفتاح أو فوترة.
  IMAGE: {
    ENABLED: true,
    REQUEST_TIMEOUT_MS: 30000,
  },
};
