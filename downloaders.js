const fetch = require("node-fetch");
const { execFile } = require("child_process");
const util = require("util");
const execFileAsync = util.promisify(execFile);
const fs = require("fs");
const path = require("path");
const config = require("./config");
const storage = require("./storage");

function isUrl(text) {
  return /^https?:\/\//i.test(text.trim());
}

function ensureDownloadsDir() {
  const dir = path.join(__dirname, "downloads");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// بيدور على أول نتيجة يوتيوب (من كام نتيجة) لسه ما اتبعتتش في نفس الجروب لنفس
// الطلب ده، عشان لو حد كتب نفس الاسم تاني ميجيلوش نفس الفيديو من الأول
async function pickFreshYoutubeResult(query, groupId) {
  const { stdout } = await execFileAsync(
    "yt-dlp",
    ["--flat-playlist", "--dump-json", "--playlist-end", "8", `ytsearch8:${query}`],
    { maxBuffer: 1024 * 1024 * 20 }
  );
  const candidates = stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  if (candidates.length === 0) return null;

  const fresh = candidates.find((c) => !storage.wasRecentlySent(groupId, "youtube", query, c.id));
  return fresh || candidates[0]; // لو كلهم اتبعتوا قبل كده، رجّع أفضل واحد على أي حال
}

// ---------------- يوتيوب (رابط مباشر أو بحث بالاسم عن طريق yt-dlp) ----------------
async function downloadYoutube(input, sock, groupId) {
  const dir = ensureDownloadsDir();
  const outPath = path.join(dir, `yt_${Date.now()}.mp4`);

  try {
    let targetUrl = input;
    let videoId = null;

    if (!isUrl(input)) {
      const picked = await pickFreshYoutubeResult(input, groupId);
      if (!picked) {
        return sock.sendMessage(groupId, { text: "❌ مقدرتش ألاقي فيديو بالاسم ده، جرب اسم تاني." });
      }
      targetUrl = picked.webpage_url || picked.url || `https://www.youtube.com/watch?v=${picked.id}`;
      videoId = picked.id;
    }

    // بنطلب أفضل جودة فيديو+صوت وبنخلي yt-dlp يدمجهم بـ ffmpeg (لازم ffmpeg
    // يكون متثبت على الجهاز)، مع فولباك لو مفيش دمج ممكن
    await execFileAsync(
      "yt-dlp",
      [
        "-f",
        "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
        "--merge-output-format",
        "mp4",
        "--no-playlist",
        "-o",
        outPath,
        targetUrl,
      ],
      { maxBuffer: 1024 * 1024 * 50 }
    );

    const buffer = fs.readFileSync(outPath);
    await sock.sendMessage(groupId, { video: buffer, caption: "✅ اتفضل الفيديو" });
    fs.unlinkSync(outPath);

    if (videoId) storage.markAsSent(groupId, "youtube", input, videoId);
  } catch (error) {
    console.error("خطأ في تحميل يوتيوب:", error?.stderr || error);
    await sock.sendMessage(groupId, {
      text:
        "❌ فشل التحميل. الأسباب الشائعة: yt-dlp محتاج تحديث (`pip install -U yt-dlp`)، " +
        "أو ffmpeg مش متثبت، أو الفيديو محمي/طويل أوي. جرب اسم أو رابط تاني.",
    });
  }
}

// بيعمل fetch بمهلة زمنية (timeout) عشان الأمر يفشل بسرعة بدل ما يعلّق لو
// السيرفر بتاع tikwm بطيء أو مش راد
async function fetchWithTimeout(url, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// بيعمل fetch لطلب JSON مع إعادة محاولات (retries) وتأخير متزايد بين كل
// محاولة والتانية، مفيد جدًا مع tikwm لأنه أحيانًا بيرفض/يتأخر مؤقتًا (rate
// limit أو ضغط على السيرفر) والمحاولة التانية أو التالتة بتنجح عادي.
// isRetryable(data, res) بتحدد لو الرد ده لازم نعيد نحاول بسببه، أو لو ده رد
// نهائي (نجاح فعلي أو فشل حقيقي مش مؤقت) ونوقف على طول.
async function fetchJsonWithRetry(url, { timeoutMs = 12000, retries = 3, baseDelayMs = 1000, isRetryable } = {}) {
  let lastError = null;
  let lastData = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchWithTimeout(url, timeoutMs);
      const data = await res.json();
      lastData = data;

      const shouldRetry = isRetryable ? isRetryable(data, res) : false;
      if (!shouldRetry) return data;
    } catch (err) {
      lastError = err;
      // لو الوقت خلص (AbortError) من غير داعي نضيّع وقت في إعادة محاولة
      // بنفس المهلة، لكن برضه بنعطي فرصة واحدة كمان بعد تأخير بسيط.
    }

    if (attempt < retries) {
      await sleep(baseDelayMs * (attempt + 1)); // تأخير متزايد: 1s ثم 2s ثم 3s...
    }
  }

  if (lastData !== null) return lastData; // آخر رد استلمناه حتى لو كان "قابل لإعادة المحاولة"
  throw lastError || new Error("فشل الطلب بعد عدة محاولات");
}

// ---------------- طابور تحكم في التزامن (Concurrency Limiter) لأمر تيك ----------------
// بيسمح بـ 3 طلبات تيك توك يشتغلوا في نفس الوقت بالظبط. أي طلب رابع أو أكتر
// بيستنى دوره أوتوماتيك (يدخل "طابور") لحد ما أحد الـ 3 الشغالين يخلص، وقتها
// بياخد مكانه على طول من غير ما المستخدم يحتاج يعيد الأمر.
const MAX_CONCURRENT_TIKTOK = 3;
let activeTiktokCount = 0;
const tiktokWaitQueue = [];

function acquireTiktokSlot() {
  if (activeTiktokCount < MAX_CONCURRENT_TIKTOK) {
    activeTiktokCount++;
    return Promise.resolve(false); // false = دخل على طول من غير انتظار
  }
  return new Promise((resolve) => tiktokWaitQueue.push(() => resolve(true))); // true = كان مستني في الطابور
}

function releaseTiktokSlot() {
  const next = tiktokWaitQueue.shift();
  if (next) {
    next(); // في حد مستني، ياخد المكان على طول (العداد مايتغيرش)
  } else {
    activeTiktokCount--;
  }
}

// ---------------- تيك توك (رابط مباشر، أو بحث بالاسم وجلب أعلى فيديو لايكات) ----------------
// لو نفس الاسم اتكرر، بيتخطى الفيديوهات اللي اتبعتت قبل كده لنفس الجروب
// ويجيب اللي بعدها في الترتيب (تاني أعلى لايكات، وهكذا) بدل ما يكرر نفس
// الفيديو.
async function downloadTiktok(input, sock, groupId) {
  // -------- الدخول في الطابور (3 تحميلات شغالة بالظبط في نفس الوقت) --------
  const hadToWait = await acquireTiktokSlot();
  if (hadToWait) {
    // بنقول للمستخدم إن طلبه اتقبل ومستني دوره، عشان ميحسش إن الأمر اتجاهل
    await sock.sendMessage(groupId, {
      text: "🕐 في 3 تحميلات شغالة دلوقتي، طلبك في الطابور وهيبدأ أول ما يفضى مكان.",
    });
  }

  try {
    let playUrl;
    let pickedInfo = "";
    let videoId = null;

    if (isUrl(input)) {
      const apiUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(input)}`;
      const data = await fetchJsonWithRetry(apiUrl, {
        retries: 3,
        baseDelayMs: 1200,
        // code !== 0 غالبًا يعني خطأ مؤقت من عند tikwm (rate limit أو ضغط)،
        // نعيد المحاولة بدل ما نستسلم على طول
        isRetryable: (d) => d?.code !== 0,
      });
      if (data?.code !== 0) console.error("tikwm رجّع خطأ (رابط مباشر) حتى بعد المحاولات:", data?.msg || data);
      playUrl = data?.data?.play;
    } else {
      // بنجيب عدد أكبر من صفحات النتايج (مش بس أول صفحتين زي الأول) ونرتبهم
      // من الأعلى لايكات للأقل، عشان نزوّد فرصة إننا نلاقي أعلى فيديو فعلاً
      // مطابق للاسم (مثلاً "ايديت كرستيانو") مش أول نتيجة عشوائية بس.
      // ملحوظة مهمة وصادقة: احنا بنبحث في نطاق خدمة tikwm نفسها (مش تيك توك
      // مباشرة)، فهي بترجع أفضل تطابق عندها هي مش أرشيف تيك توك كامل، فمينفعش
      // نضمن 100% إنه الأعلى لايكات على التطبيق كله، لكن ده أقصى دقة ممكنة.
      const buildSearchUrl = (offset) =>
        `https://www.tikwm.com/api/feed/search?keywords=${encodeURIComponent(input)}&count=20&cursor=${offset}`;

      let data;
      let allVideos = [];
      const offsets = [0, 20, 40, 60]; // 4 صفحات بدل صفحتين = تغطية أوسع للترتيب
      // بنعمل لحد جولتين كاملتين لو الجولة الأولى رجّعت فاضية (rate limit مؤقت)
      for (let round = 0; round < 2 && allVideos.length === 0; round++) {
        if (round > 0) await sleep(1500);
        for (const offset of offsets) {
          data = await fetchJsonWithRetry(buildSearchUrl(offset), {
            retries: 2,
            baseDelayMs: 1000,
            isRetryable: (d) => d?.code !== 0,
          });
          const pageVideos = data?.data?.videos || [];
          if (pageVideos.length === 0) break; // خلصت النتايج، مفيش داعي نكمل صفحات
          allVideos = allVideos.concat(pageVideos);
        }
      }

      if (allVideos.length === 0) {
        console.error("tikwm رجّع صفر فيديوهات للبحث حتى بعد المحاولات:", data?.msg || data);
        return sock.sendMessage(groupId, { text: "❌ مقدرتش ألاقي فيديوهات بالاسم ده، جرب اسم تاني." });
      }

      const sorted = [...allVideos].sort((a, b) => (b.digg_count || 0) - (a.digg_count || 0));
      // بناخد أول فيديو في الترتيب لسه ما اتبعتش لنفس الطلب ده قبل كده
      const fresh = sorted.find((v) => !storage.wasRecentlySent(groupId, "tiktok", input, v.video_id || v.id));
      const best = fresh || sorted[0];

      playUrl = best?.play;
      videoId = best?.video_id || best?.id || null;
      const likes = best.digg_count ? best.digg_count.toLocaleString("en-US") : "؟";
      pickedInfo = `\n❤️ اللايكات: ${likes}`;
    }

    if (!playUrl) {
      return sock.sendMessage(groupId, { text: "❌ مقدرتش ألاقي/أجيب الفيديو، جرب اسم/رابط تاني." });
    }

    const videoRes = await fetchWithTimeout(playUrl, 20000);
    const buffer = await videoRes.buffer();
    await sock.sendMessage(groupId, { video: buffer, caption: `✅ اتفضل الفيديو من تيك توك${pickedInfo}` });

    if (videoId) storage.markAsSent(groupId, "tiktok", input, videoId);
  } catch (err) {
    console.error("خطأ في تحميل تيك توك:", err);
    const timedOut = err.name === "AbortError";
    await sock.sendMessage(groupId, {
      text: timedOut
        ? "⏳ تيك توك بطيء دلوقتي، جرب تاني كمان شوية."
        : "❌ حصل خطأ في تحميل فيديو التيك توك. جرب تاني كمان شوية.",
    });
  } finally {
    // -------- الخروج من الطابور دايمًا (حتى لو حصل خطأ) --------
    // عشان المكان يفضى فورًا لأي حد تاني مستني، وميحصلش تسريب "مكان" فاضل
    // مشغول للأبد لو حصل استثناء غير متوقع.
    releaseTiktokSlot();
  }
}

// ---------------- انستجرام ----------------
// ملاحظة مهمة: انستجرام مالوش API رسمي مجاني للتحميل، وأي خدمة خارجية
// بتستخدمها ممكن تتغير أو توقف من غير سابق إنذار. الكود ده بيستخدم خدمة
// عامة معروفة، لو بطلت تشتغل هتحتاج تدور على بديل وتغيّر الرابط بس.
async function downloadInstagram(url, sock, groupId) {
  try {
    const apiUrl = `https://api.tiklydown.eu.org/api/download/instagram?url=${encodeURIComponent(url)}`;
    const res = await fetch(apiUrl);
    const data = await res.json();

    const mediaUrl = data?.result?.video || data?.result?.image || data?.video || data?.image;
    if (!mediaUrl) {
      return sock.sendMessage(groupId, {
        text: "❌ مقدرتش أجيب المحتوى ده. ممكن الخدمة تكون واقفة حالياً أو الرابط خاص.",
      });
    }

    const mediaRes = await fetch(mediaUrl);
    const buffer = await mediaRes.buffer();
    const isVideo = !!data?.result?.video || !!data?.video;

    await sock.sendMessage(groupId, {
      [isVideo ? "video" : "image"]: buffer,
      caption: "✅ اتفضل من انستجرام",
    });
  } catch (err) {
    console.error(err);
    await sock.sendMessage(groupId, {
      text: "❌ حصل خطأ في تحميل محتوى انستجرام. الخدمة دي مش مضمونة الاستقرار.",
    });
  }
}

// ---------------- تفريغ الرسايل الصوتية (لازم مفتاح Groq المجاني في config.js) ----------------
// ---------------- تفريغ الرسايل الصوتية (Groq - نسخة Whisper مجانية بالكامل) ----------------
// محتاج مفتاح مجاني من https://console.groq.com/keys (من غير أي بطاقة ائتمان)
// حطه في config.js تحت GROQ_API_KEY.
async function transcribeVoice(audioBuffer, sock, groupId) {
  if (!config.GROQ_API_KEY) {
    return sock.sendMessage(groupId, {
      text:
        "❌ ميزة تفريغ الصوت محتاجة مفتاح Groq المجاني في config.js (GROQ_API_KEY).\n" +
        "تقدر تجيبه مجانًا من غير أي دفع من هنا:\nhttps://console.groq.com/keys",
    });
  }
  try {
    const dir = ensureDownloadsDir();
    const filePath = path.join(dir, `voice_${Date.now()}.ogg`);
    fs.writeFileSync(filePath, audioBuffer);

    const FormData = require("form-data");
    const form = new FormData();
    form.append("file", fs.createReadStream(filePath));
    form.append("model", "whisper-large-v3-turbo");

    const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.GROQ_API_KEY}` },
      body: form,
    });
    const data = await res.json();
    fs.unlinkSync(filePath);

    if (!data?.text) {
      console.error("خطأ من Groq (تفريغ صوت):", data?.error || data);
      return sock.sendMessage(groupId, { text: "❌ مقدرتش أفرّغ الرسالة الصوتية." });
    }
    await sock.sendMessage(groupId, { text: `📝 تفريغ الرسالة الصوتية:\n${data.text}` });
  } catch (err) {
    console.error(err);
    await sock.sendMessage(groupId, { text: "❌ حصل خطأ في تفريغ الصوت." });
  }
}

// ملاحظة: نظام الشات الذكي (.شات) بيستخدم Groq للنصوص (سريع جدًا وحده
// المجاني أعلى من Gemini) وGemini لتوليد الصور بس - شوف chat/index.js،
// chat/groqClient.js، وchat/imageGen.js.

// ---------------- فيسبوك ----------------
// ملحوظة: زي انستجرام بالظبط، فيسبوك مالوش API رسمي مجاني للتحميل، فالكود
// ده بيستخدم خدمة عامة، ولو بطلت تشتغل هتحتاج تدور على بديل وتغيّر الرابط بس.
async function downloadFacebook(url, sock, groupId) {
  try {
    const apiUrl = `https://api.tiklydown.eu.org/api/download/facebook?url=${encodeURIComponent(url)}`;
    const res = await fetch(apiUrl);
    const data = await res.json();

    const mediaUrl =
      data?.result?.hd || data?.result?.sd || data?.result?.video || data?.hd || data?.sd;
    if (!mediaUrl) {
      return sock.sendMessage(groupId, {
        text: "❌ مقدرتش أجيب الفيديو ده. ممكن الخدمة تكون واقفة حالياً أو الرابط خاص.",
      });
    }

    const mediaRes = await fetch(mediaUrl);
    const buffer = await mediaRes.buffer();
    await sock.sendMessage(groupId, { video: buffer, caption: "✅ اتفضل من فيسبوك" });
  } catch (err) {
    console.error(err);
    await sock.sendMessage(groupId, {
      text: "❌ حصل خطأ في تحميل فيديو فيسبوك. الخدمة دي مش مضمونة الاستقرار.",
    });
  }
}

// ---------------- تويتر / X ----------------
// نفس الملحوظة: خدمة عامة غير رسمية، ممكن تتغير أو توقف في أي وقت.
async function downloadTwitter(url, sock, groupId) {
  try {
    const apiUrl = `https://api.tiklydown.eu.org/api/download/twitter?url=${encodeURIComponent(url)}`;
    const res = await fetch(apiUrl);
    const data = await res.json();

    const mediaUrl = data?.result?.video || data?.result?.hd || data?.result?.sd;
    if (!mediaUrl) {
      return sock.sendMessage(groupId, {
        text: "❌ مقدرتش أجيب الفيديو ده. ممكن الخدمة تكون واقفة حالياً أو الرابط خاص/التغريدة مالهاش فيديو.",
      });
    }

    const mediaRes = await fetch(mediaUrl);
    const buffer = await mediaRes.buffer();
    await sock.sendMessage(groupId, { video: buffer, caption: "✅ اتفضل من تويتر/X" });
  } catch (err) {
    console.error(err);
    await sock.sendMessage(groupId, {
      text: "❌ حصل خطأ في تحميل فيديو تويتر/X. الخدمة دي مش مضمونة الاستقرار.",
    });
  }
}

// ---------------- تحميل صوت (mp3) من يوتيوب بس ----------------
// ملحوظة: يوتيوب بقى بيرفض طلبات yt-dlp العادية كتير في 2026 برسالة "Sign in
// to confirm you're not a bot". أشهر حل معروف هو تجربة "android player
// client" كبديل، فبنجربه تلقائيًا لو المحاولة العادية فشلت.
function runYtDlp(args) {
  return new Promise((resolve, reject) => {
    execFile("yt-dlp", args, { maxBuffer: 1024 * 1024 * 50 }, (error, stdout, stderr) => {
      if (error) {
        error.stderr = stderr;
        return reject(error);
      }
      resolve(stdout);
    });
  });
}

async function downloadYoutubeAudio(input, sock, groupId) {
  const dir = ensureDownloadsDir();
  const outPath = path.join(dir, `yt_audio_${Date.now()}.mp3`);
  const target = isUrl(input) ? input : `ytsearch1:${input}`;
  const baseArgs = ["-x", "--audio-format", "mp3", "-o", outPath, target];

  try {
    // المحاولة الأولى: عادي زي ما هي
    await runYtDlp(baseArgs);
  } catch (firstError) {
    console.error("فشلت المحاولة الأولى لتحميل الصوت (yt-dlp):", firstError.stderr || firstError.message);

    // لو الخطأ بيرمز لحظر بوتات يوتيوب، نجرب android client كبديل معروف
    const isBotBlock = /sign in to confirm|not a bot/i.test(firstError.stderr || "");
    if (!isBotBlock) {
      return sock.sendMessage(groupId, { text: "❌ فشل تحميل الصوت، جرب اسم/رابط تاني." });
    }

    try {
      await runYtDlp([...baseArgs, "--extractor-args", "youtube:player_client=android"]);
    } catch (secondError) {
      console.error("فشلت محاولة android client كمان:", secondError.stderr || secondError.message);
      return sock.sendMessage(groupId, {
        text: "❌ يوتيوب بيرفض الطلب حاليًا (حماية بوتات). جرب تاني بعد شوية، أو حدّث yt-dlp على السيرفر (yt-dlp -U).",
      });
    }
  }

  try {
    const buffer = fs.readFileSync(outPath);
    await sock.sendMessage(groupId, {
      audio: buffer,
      mimetype: "audio/mpeg",
      caption: "✅ اتفضل الصوت",
    });
    fs.unlinkSync(outPath);
  } catch (e) {
    console.error("خطأ بعد نجاح التحميل (قراءة/إرسال الملف):", e.message);
    await sock.sendMessage(groupId, { text: "❌ الملف كبير أوي أو حصل خطأ." });
  }
}

// ---------------- توليد صور بالذكاء الاصطناعي (Pollinations.ai - مجاني بالكامل، من غير مفتاح) ----------------
// كنا بنستخدم Gemini image هنا، لكن اتضح إن موديلات الصور عند جوجل بتاخد
// "limit: 0" على الفري تير العادي (محتاجة فوترة مفعّلة حتى لو الاستخدام
// نفسه هيفضل تحت الحد المجاني). Pollinations.ai مجاني تمامًا من غير أي
// مفتاح أو فوترة خالص.
// بيستخدم نفس نظام تحسين البرومبت (ترجمة عربي->إنجليزي + تفاصيل بصرية عن
// طريق Groq) وموديل flux المستخدمين في .صورة_شات، عشان الصورة تطلع مطابقة
// فعلاً للوصف اللي المستخدم كتبه بدل ما تطلع حاجة عشوائية غلط.
const chatImageGen = require("./chat/imageGen");

async function generateImage(prompt, sock, groupId) {
  try {
    const buffer = await chatImageGen.generateImage(prompt);
    await sock.sendMessage(groupId, { image: buffer, caption: `🎨 ${prompt}` });
  } catch (err) {
    console.error("خطأ في توليد الصورة (.صورة):", err.message);
    const isTimeout = err.code === "TIMEOUT";
    await sock.sendMessage(groupId, {
      text: isTimeout
        ? "⏳ توليد الصورة استغرق وقت طويل أوي، جرب تاني."
        : "❌ مقدرتش أعمل الصورة، جرب وصف تاني أو حاول كمان شوية.",
    });
  }
}

// ---------------- بحث دقيق (Gemini + أداة البحث بجوجل - بيرجع إجابة حقيقية مبنية على نتايج بحث فعلية) ----------------
// بيستخدم نفس مفتاح Gemini المجاني بتاع .اسأل (GEMINI_API_KEY)
async function quickSearch(query, sock, groupId) {
  if (!config.GEMINI_API_KEY) {
    return sock.sendMessage(groupId, {
      text:
        "❌ ميزة البحث محتاجة مفتاح Gemini المجاني في config.js (GEMINI_API_KEY).\n" +
        "تقدر تجيبه في دقيقتين من هنا: https://aistudio.google.com/apikey",
    });
  }
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${config.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                {
                  text:
                    `دور على إجابة دقيقة وحديثة للسؤال ده وجاوب باللهجة المصرية باختصار ` +
                    `ووضوح (كام سطر بس)، بالاعتماد على نتايج بحث حقيقية:\n${query}`,
                },
              ],
            },
          ],
          tools: [{ google_search: {} }],
        }),
      }
    );
    const data = await res.json();

    if (data?.error) {
      console.error("خطأ من Gemini (بحث):", data.error);
      return sock.sendMessage(groupId, { text: "❌ حصل خطأ في البحث، جرب تاني كمان شوية." });
    }

    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("").trim();
    if (!text) {
      return sock.sendMessage(groupId, {
        text: `❌ مقدرتش ألاقي إجابة لـ "${query}". جرب صيغة تانية.`,
      });
    }
    await sock.sendMessage(groupId, { text: `🔍 ${text}` });
  } catch (err) {
    console.error("خطأ في البحث:", err);
    await sock.sendMessage(groupId, { text: "❌ حصل خطأ في البحث." });
  }
}

// ---------------- تغيير صورة الجروب ----------------
// بتاخد بفر الصورة (بعد التحميل بالفعل) وتحدث بيها صورة الجروب
async function changeGroupPicture(sock, groupId, imageBuffer) {
  await sock.updateProfilePicture(groupId, imageBuffer);
}

// ---------------- تحويل ملصق (استيكر) لصورة عادية ----------------
// بيحاول sharp الأول (أسرع)، ولو مكتبتها الأصلية (native) مش شغالة على
// السيرفر ده (مشكلة شائعة أوي مع sharp عبر أنظمة تشغيل/معالجات مختلفة)،
// بيعمل fallback أوتوماتيك لـ jimp (مكتبة جافاسكريبت خالص من غير أي كود
// native، فهي بتشتغل أكيد على أي سيرفر - Termux/ARM/Linux/VPS إلخ).
async function convertStickerToImage(webpBuffer) {
  try {
    const sharp = require("sharp");
    return await sharp(webpBuffer).png().toBuffer();
  } catch (sharpErr) {
    console.error("sharp فشلت (هجرب jimp بدالها):", sharpErr.message);
    const { Jimp } = require("jimp");
    const image = await Jimp.read(webpBuffer);
    return image.getBuffer("image/png");
  }
}

module.exports = {
  downloadYoutube,
  downloadTiktok,
  downloadInstagram,
  transcribeVoice,
  downloadFacebook,
  downloadTwitter,
  downloadYoutubeAudio,
  generateImage,
  quickSearch,
  changeGroupPicture,
  convertStickerToImage,
};
