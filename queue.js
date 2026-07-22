/**
 * طابور بسيط لتنفيذ المهام بعدد متزامن محدود (concurrency limit). بيمنع إغراق
 * الموديل المحلي بطلبات كتير مرة واحدة (اللي ممكن يستهلك الرامات ويبطئ كل حاجة)،
 * وبيحافظ على ترتيب عادل (FIFO) للطلبات.
 */

const chatConfig = require("./config");
const logger = require("./logger");

class TaskQueue {
  constructor({ concurrency = 1, maxSize = 50 } = {}) {
    this.concurrency = Math.max(1, concurrency);
    this.maxSize = maxSize;
    this.running = 0;
    this.pending = []; // [{ task, resolve, reject, enqueuedAt }]
  }

  size() {
    return this.pending.length;
  }

  isFull() {
    return this.pending.length >= this.maxSize;
  }

  // بيضيف مهمة (async function) للطابور، وبيرجع Promise بنتيجتها
  enqueue(task) {
    if (this.isFull()) {
      return Promise.reject(new Error("QUEUE_FULL"));
    }
    return new Promise((resolve, reject) => {
      this.pending.push({ task, resolve, reject, enqueuedAt: Date.now() });
      this._processNext();
    });
  }

  _processNext() {
    if (this.running >= this.concurrency) return;
    const item = this.pending.shift();
    if (!item) return;

    this.running++;
    const waitMs = Date.now() - item.enqueuedAt;
    if (waitMs > 3000) {
      logger.debug("طلب استنى في الطابور فترة طويلة نسبيًا", { waitMs });
    }

    Promise.resolve()
      .then(() => item.task())
      .then((result) => item.resolve(result))
      .catch((err) => item.reject(err))
      .finally(() => {
        this.running--;
        this._processNext();
      });
  }
}

// طابور واحد مشترك لكل طلبات الشات (نص + صور) عشان يحمي الموديل المحلي
const chatQueue = new TaskQueue({
  concurrency: chatConfig.QUEUE_CONCURRENCY,
  maxSize: chatConfig.QUEUE_MAX_SIZE,
});

module.exports = { TaskQueue, chatQueue };
