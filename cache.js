/**
 * كاش في الذاكرة (Map) بحد أقصى لعدد العناصر ومدة صلاحية (TTL) لكل عنصر.
 * بيوفر وقت ومعالجة لو نفس السؤال (بنفس الموديل والشخصية) اتسأل تاني قريب.
 */

const chatConfig = require("./config");

class SimpleCache {
  constructor({ ttlMs, maxEntries }) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.store = new Map(); // key -> { value, expiresAt }
  }

  _isExpired(entry) {
    return !entry || Date.now() > entry.expiresAt;
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (this._isExpired(entry)) {
      this.store.delete(key);
      return undefined;
    }
    // نحرك المفتاح لآخر الترتيب (LRU بسيط) عن طريق إعادة إدراجه
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  set(key, value) {
    if (this.store.has(key)) this.store.delete(key);
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });

    // لو تعدينا الحد الأقصى، نشيل الأقدم (أول عنصر في الـ Map)
    while (this.store.size > this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      this.store.delete(oldestKey);
    }
  }

  delete(key) {
    this.store.delete(key);
  }

  clear() {
    this.store.clear();
  }

  size() {
    return this.store.size;
  }
}

// مفتاح كاش موحّد بناءً على الموديل + الشخصية + آخر سؤال (والسياق القريب لو موجود)
function buildKey({ model, persona, prompt, contextTail }) {
  return JSON.stringify({
    m: model,
    p: persona,
    q: prompt.trim().toLowerCase(),
    c: contextTail || "",
  });
}

const chatCache = new SimpleCache({
  ttlMs: chatConfig.CACHE_TTL_MS,
  maxEntries: chatConfig.CACHE_MAX_ENTRIES,
});

module.exports = { SimpleCache, chatCache, buildKey };
