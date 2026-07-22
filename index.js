/**
 * بوت إدارة جروبات واتساب "Hunter Bot"
 * الملف ده بينسّق بين الاتصال بواتساب وكل الوحدات التانية:
 * config.js, storage.js, filters.js, commands.js, games.js, downloaders.js, statusSaver.js
 */

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
} = require("@whiskeysockets/baileys");
const { Boom } = require("@hapi/boom");
const pino = require("pino");
const qrcode = require("qrcode-terminal");

// معالجات عامة عشان أي خطأ غير متوقع يتسجل بس ومايوقفش البوت كله
process.on("unhandledRejection", (err) => {
  console.error("خطأ غير متوقع (unhandledRejection):", err);
});
process.on("uncaughtException", (err) => {
  console.error("خطأ غير متوقع (uncaughtException):", err);
});

const config = require("./config");
const storage = require("./storage");
const filters = require("./filters");
const games = require("./games");
const statusSaver = require("./statusSaver");
const permissions = require("./permissions");
const banlist = require("./banlist");
const groupSettings = require("./groupSettings");
const scheduler = require("./scheduler");
const style = require("./style");
const { handleCommand } = require("./commands");

// -------- سيرفر HTTP بسيط (مطلوب لـ Fly.io/Render وأي منصة hosting بتعمل
// health-check بروكسي) --------
// البوت نفسه اتصال WhatsApp داخلي (WebSocket) مش سيرفر HTTP، فمنصات زي
// Fly.io بتفتكر إن التطبيق "واقع" لو مفيش حاجة بترد على البورت، وبتفضل
// تعمل ريستارت للـ machine باستمرار. السيرفر الصغير ده بس بيرد "OK" عشان
// يطمن المنصة إن البروسس شغال، وملوش أي علاقة بمنطق البوت نفسه.
const http = require("http");
const PORT = process.env.PORT || 8080;
http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Hunter Bot شغال ✅");
  })
  .listen(PORT, "0.0.0.0", () => {
    console.log(`HTTP health-check server شغال على البورت ${PORT}`);
  });

// أوامر متعددة الكلمات - المستخدم يقدر يكتبها عادي بمسافة (زي "فك كتم")
// من غير احتياج لـ "_"، والكود هنا هو اللي بيربطهم بالاسم الداخلي.
// مرتبة من الأطول للأقصر عشان الأطول ياخد أولوية في التطابق.
const MULTI_WORD_COMMANDS = [
  "الغاء_الحظر",
  "تعيين_القوانين",
  "نتيجة_التصويت",
  "انهاء_التصويت",
  "الاحصائيات_كاملة",
  "القائمة_السوداء",
  "طرد_الخاملين",
  "حسبه_كليه",
  "حسبة_كلية",
  "مسح_تحذير",
  "اعاده_الشات",
  "مسح_الشات",
  "معلومات_الشات",
  "حالة_الشات",
  "صورة_شات",
  "ملصق_لصورة",
  "استيكر_لصورة",
  "وقف_اللعبة",
  "الغاء_حظر",
  "فك_كتم",
  "صورة_الجروب",
  "تغيير_الصورة",
  "حظر_الروابط",
].sort((a, b) => b.split("_").length - a.split("_").length);

// بياخد قايمة الكلمات المكتوبة، ويحاول يلاقي أطول أمر متعدد الكلمات مطابق
// في أوله. لو لقى، بيرجع اسم الأمر الداخلي (بالـ underscore) والباقي كـ args.
function matchMultiWordCommand(rawWords) {
  for (const multi of MULTI_WORD_COMMANDS) {
    const parts = multi.split("_");
    if (rawWords.length < parts.length) continue;
    const isMatch = parts.every((part, i) => rawWords[i] === part);
    if (isMatch) {
      return { command: multi, restArgs: rawWords.slice(parts.length) };
    }
  }
  return null;
}

// استخراج الرقم بس من أي شكل JID (يحل مشكلة اختلاف @s.whatsapp.net مقابل @lid)
function numberOf(jid) {
  if (!jid) return null;
  return jid.split("@")[0].split(":")[0].replace(/\D/g, "");
}

// -------- كاش بيانات الجروب: بيقلل طلبات الشبكة عشان البوت يرد بسرعة --------
// من غير الكاش ده، كل رسالة عادية كانت بتعمل طلب groupMetadata كامل لواتساب.
// الكاش بيتلغي فورًا لما حد يتضاف/يتشال/يترقى عشان صلاحيات الأدمن تفضل محدثة.
const GROUP_META_TTL_MS = 15000;
async function getGroupMeta(sock, groupId) {
  const cached = storage.groupMetaCache[groupId];
  if (cached && Date.now() - cached.time < GROUP_META_TTL_MS) {
    return cached.data;
  }
  const data = await sock.groupMetadata(groupId);
  storage.groupMetaCache[groupId] = { data, time: Date.now() };
  return data;
}

// بيرد بالنتيجة المناسبة حسب نوع اللعبة الشغالة والإجابة اللي جتلها
async function sendGameOutcome(sock, groupId, sender, outcome) {
  switch (outcome.type) {
    case "number": {
      if (outcome.result === "correct") {
        await sock.sendMessage(groupId, {
          text: `🎉 برافو @${sender.split("@")[0]}! خمّنت الرقم صح بعد ${outcome.tries} محاولة.`,
          mentions: [sender],
        });
      } else if (outcome.result === "high") {
        await sock.sendMessage(groupId, { text: "الرقم أصغر من كده ⬇️" });
      } else if (outcome.result === "low") {
        await sock.sendMessage(groupId, { text: "الرقم أكبر من كده ⬆️" });
      }
      break;
    }
    case "word": {
      await sock.sendMessage(groupId, {
        text: `🎉 برافو @${sender.split("@")[0]}! خمّنت الكلمة صح.`,
        mentions: [sender],
      });
      break;
    }
    case "math": {
      await sock.sendMessage(groupId, {
        text: `🎉 برافو @${sender.split("@")[0]}! إجابة صح.`,
        mentions: [sender],
      });
      break;
    }
    case "truefalse": {
      const correctText = outcome.correctAnswer ? "صح" : "غلط";
      if (outcome.result === "correct") {
        await sock.sendMessage(groupId, {
          text: `🎉 برافو @${sender.split("@")[0]}! إجابة صح.`,
          mentions: [sender],
        });
      } else {
        await sock.sendMessage(groupId, {
          text: `❌ للأسف غلط يا @${sender.split("@")[0]}. الإجابة الصح كانت: ${correctText}`,
          mentions: [sender],
        });
      }
      break;
    }
    case "trivia": {
      if (outcome.result === "correct") {
        await sock.sendMessage(groupId, {
          text: `🎉 برافو @${sender.split("@")[0]}! إجابة صح.`,
          mentions: [sender],
        });
      } else {
        await sock.sendMessage(groupId, {
          text: `❌ غلط يا @${sender.split("@")[0]}. الإجابة الصح كانت رقم ${outcome.correctAnswer}`,
          mentions: [sender],
        });
      }
      break;
    }
    case "unscramble": {
      await sock.sendMessage(groupId, {
        text: `🎉 برافو @${sender.split("@")[0]}! رتّبت الكلمة صح.`,
        mentions: [sender],
      });
      break;
    }
  }
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("auth_info");
  const { version } = await fetchLatestBaileysVersion();
  const knownGroupIds = new Set(); // الجروبات اللي البوت أصلاً فيها من قبل التشغيل ده

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: "silent" }),
    printQRInTerminal: false,
  });

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      console.log("امسح الـ QR ده من واتساب (أجهزة مرتبطة > ربط جهاز):");
      qrcode.generate(qr, { small: true });
    }
    if (connection === "close") {
      const shouldReconnect =
        new Boom(lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log("الاتصال اتقفل. إعادة الاتصال:", shouldReconnect);
      if (shouldReconnect) startBot();
    } else if (connection === "open") {
      console.log(`✅ بوت ${config.BOT_NAME} اتصل بنجاح بواتساب`);
      try {
        const existingGroups = await sock.groupFetchAllParticipating();
        Object.keys(existingGroups).forEach((id) => knownGroupIds.add(id));
      } catch (e) {
        console.error("مقدرتش أجيب قائمة الجروبات الحالية:", e.message);
      }
      scheduler.startScheduler(sock);
    }
  });

  sock.ev.on("creds.update", saveCreds);

  // ================= استقبال الرسايل =================
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    // نتجاهل رسايل المزامنة القديمة (history sync)، بنعالج الرسايل الجديدة بس
    if (type !== "notify") return;

    const msg = messages[0];
    try {
      if (!msg.message) return;

      // نتجاهل أي رسالة عمرها أكتر من دقيقة (احتياط إضافي وقت إعادة الاتصال)
      const msgTime = Number(msg.messageTimestamp) * 1000;
      if (msgTime && Date.now() - msgTime > 60000) return;

      // رسايل الحالات
      if (msg.key.remoteJid === "status@broadcast") {
        return statusSaver.handleStatusMessage(sock, msg);
      }

      if (msg.key.fromMe) return;
      const groupId = msg.key.remoteJid;
      if (!groupId.endsWith("@g.us")) return; // بوت جروبات بس

      const sender = msg.key.participant || msg.key.remoteJid;
      const groupMeta = await getGroupMeta(sock, groupId);
      const participants = groupMeta.participants;

      const senderNum = numberOf(sender);
      const ownerNum = numberOf(config.OWNER_NUMBER);

      const senderIsAdmin = !!participants.find(
        (p) => numberOf(p.id) === senderNum && (p.admin === "admin" || p.admin === "superadmin")
      );
      const senderIsOwner = await permissions.isOwner(sock, sender);
      const canManage = senderIsOwner || senderIsAdmin;

      const botIdCandidates = [
        sock.user?.id,
        sock.user?.lid,
        sock.authState?.creds?.me?.id,
        sock.authState?.creds?.me?.lid,
      ]
        .filter(Boolean)
        .map(numberOf);

      const botIsAdmin = !!participants.find(
        (p) => botIdCandidates.includes(numberOf(p.id)) && (p.admin === "admin" || p.admin === "superadmin")
      );

      const messageType = Object.keys(msg.message)[0];
      const textBody =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        msg.message.imageMessage?.caption ||
        "";

      const isExempt = senderIsOwner || senderIsAdmin;

      // تتبع النشاط والإحصائيات لكل الأعضاء (حتى المعفيين)
      storage.trackActivity(groupId, sender);

      // -------- إجابة على لعبة شغالة (أي نوع من الألعاب) --------
      if (games.isGameActive(groupId)) {
        const outcome = games.handleAnswer(groupId, textBody);
        if (outcome) {
          await sendGameOutcome(sock, groupId, sender, outcome);
          return;
        }
      }

      // -------- فلتر السبام --------
      if (!isExempt && storage.isSpamming(groupId, sender)) {
        return handleViolation(sock, groupId, sender, botIsAdmin, config.SPAM_WARNING, "سبام");
      }

      // -------- حماية قوية وفورية: لينكات / جهات اتصال / فوروارد --------
      // حذف الرسالة + طرد صاحبها في نفس اللحظة (من غير نظام تحذيرات).
      // الاستثناء الوحيد هو صاحب البوت - حتى الأدمنز خاضعين للحماية دي.
      //
      // ملحوظة مهمة: لو الرسالة أمر (بتبدأ بالبريفكس زي ".")، منستثنيهاش من
      // فحص اللينكات بالذات - عشان أوامر زي .mp3 و.فيسبوك و.تويتر محتاجة
      // تقبل لينكات كجزء طبيعي من شغلها (تحميل من SoundCloud مثلاً). باقي
      // الحمايات (جهات اتصال / فوروارد / رسايل مشبوهة) لسه شغالة عادي حتى
      // على رسايل الأوامر.
      const looksLikeCommand = config.PREFIXES.some((p) => textBody.startsWith(p));

      if (!senderIsOwner && botIsAdmin) {
        const hasLink = !looksLikeCommand && filters.isBlockedLink(textBody, groupId);
        const hasContact = filters.isContactMessage(messageType);
        const hasForward = filters.isForwarded(msg);
        const hasSuspiciousPayload = filters.isSuspiciousPayload(msg, textBody);

        if (hasLink || hasContact || hasForward || hasSuspiciousPayload) {
          const template = hasLink
            ? config.INSTANT_KICK_LINK
            : hasContact
            ? config.INSTANT_KICK_CONTACT
            : hasForward
            ? config.INSTANT_KICK_FORWARD
            : config.INSTANT_KICK_SUSPICIOUS;

          // حذف الرسالة وطرد صاحبها بالتوازي عشان الاستجابة تبقى أسرع ما يمكن
          await Promise.allSettled([
            sock.sendMessage(groupId, { delete: msg.key }),
            sock.groupParticipantsUpdate(groupId, [sender], "remove"),
          ]);
          await sock.sendMessage(groupId, {
            text: style.danger(template.replace("%USER%", style.mention(sender))),
            mentions: [sender],
          });
          return;
        }
      }

      // -------- ردود تلقائية --------
      if (config.AUTO_REPLIES[textBody.trim()]) {
        await sock.sendMessage(groupId, { text: config.AUTO_REPLIES[textBody.trim()] });
        return;
      }

      // -------- الأوامر --------
      const usedPrefix = config.PREFIXES.find((p) => textBody.startsWith(p));
      if (!usedPrefix) return;

      // -------- التحقق من صلاحية استخدام أوامر البوت --------
      // أي حد رقمه مش صاحب البوت ومش موجود في config.ALLOWED_USERS (أو
      // مضاف بأمر .اشراف اضافه) مايقدرش يستخدم ولا أمر واحد (حتى المساعدة
      // والألعاب)، والبوت بيسكت تمام (من غير أي رد) عشان محدش يقدر يستفز
      // البوت يرد عليه أو يسبام بيه من غير ما يكون مسموح له.
      if (!(await permissions.isAllowed(sock, sender))) {
        return;
      }

      const rawWords = textBody.slice(usedPrefix.length).trim().split(/\s+/);
      let command, args;
      const multiMatch = matchMultiWordCommand(rawWords);
      if (multiMatch) {
        command = multiMatch.command;
        args = multiMatch.restArgs;
      } else {
        args = [...rawWords];
        command = args.shift().toLowerCase();
      }

      function getTargetUser() {
        const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid;
        const quotedParticipant = msg.message.extendedTextMessage?.contextInfo?.participant;
        if (mentioned && mentioned.length > 0) return mentioned[0];
        if (quotedParticipant) return quotedParticipant;
        return null;
      }

      const quotedMsg = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;

      async function downloadQuotedAudio() {
        const ctxInfo = msg.message.extendedTextMessage.contextInfo;
        const fakeMsg = {
          key: {
            remoteJid: groupId,
            id: ctxInfo.stanzaId,
            participant: ctxInfo.participant,
          },
          message: quotedMsg,
        };
        return downloadMediaMessage(fakeMsg, "buffer", {}, {
          logger: pino({ level: "silent" }),
          reuploadRequest: sock.updateMediaMessage,
        });
      }

      // نفس الفكرة بالظبط، لكن اسم عام عشان نستخدمه مع أي نوع ميديا
      // (صورة/ملصق/فيديو) مش الصوت بس - زي .صورة_الجروب و.تحويل
      const downloadQuotedMedia = downloadQuotedAudio;

      // نوع الرسالة المردود عليها (imageMessage / stickerMessage / ...) عشان
      // الأوامر تتأكد قبل ما تحاول تنزل حاجة مش موجودة
      const quotedType = quotedMsg ? Object.keys(quotedMsg)[0] : null;

      await handleCommand(sock, {
        command,
        args,
        groupId,
        groupName: groupMeta.subject,
        sender,
        senderIsOwner,
        senderIsAdmin,
        canManage,
        botIsAdmin,
        participants,
        getTargetUser,
        quotedMsg,
        downloadQuotedAudio,
        downloadQuotedMedia,
        quotedType,
      });
    } catch (err) {
      console.error("خطأ في معالجة الرسالة:", err);
    }
  });

  // ================= أعضاء الجروب (دخول/خروج/طرد) =================
  // ملحوظة مهمة (كان هنا سبب مشكلة الترحيب اللي مش بيشتغل): اسم الـ event في
  // مكتبة baileys هو "group-participants.update" (بنقطة)، مش
  // "group-participants-update" (بشرطة). الاسمين مختلفين تمامًا بالنسبة لـ
  // Node.js، فكان الكود بيستنى event غلط ومبيوصلوش أي حدث أبدًا - عشان كده
  // الترحيب (وحماية طرد الأعضاء المحميين) مكانوش بيشتغلوا خالص.
  sock.ev.on("group-participants.update", async ({ id: groupId, participants, action, author }) => {
    try {
      // أي تغيير في الأعضاء (إضافة/طرد/ترقية) يلغي كاش بيانات الجروب فورًا
      // عشان صلاحيات الأدمن تفضل محدثة على طول من غير تأخير.
      delete storage.groupMetaCache[groupId];

      const ownerNum = numberOf(config.OWNER_NUMBER);
      const authorNum = numberOf(author);

      if (action === "add") {
        console.log(`[ترحيب] استقبلنا حدث انضمام في الجروب ${groupId} لـ ${participants.length} عضو.`);
        for (const participant of participants) {
          try {
            // -------- فحص قايمة الحظر الدائم الأول --------
            // لو الشخص محظور نهائيًا، يتطرد فورًا من غير رسالة ترحيب.
            if (banlist.isBanned(participant)) {
              console.log(`[ترحيب] ${participant} في قايمة الحظر، هيتطرد من غير ترحيب.`);
              try {
                await sock.groupParticipantsUpdate(groupId, [participant], "remove");
                await sock.sendMessage(groupId, {
                  text: style.danger(`🚫 @${participant.split("@")[0]} محظور نهائيًا، تم طرده أوتوماتيك.`),
                  mentions: [participant],
                });
              } catch (e) {
                console.log("مقدرتش أطرد شخص محظور (لازم يكون البوت أدمن):", e.message);
              }
              continue;
            }

            if (!groupSettings.isWelcomeEnabled(groupId)) {
              console.log(`[ترحيب] الترحيب التلقائي متعطل في الجروب ${groupId} (اكتب "الترحيب تشغيل").`);
              continue;
            }

            console.log(`[ترحيب] هببعت رسالة ترحيب لـ ${participant} في ${groupId}...`);
            await sock.sendMessage(groupId, {
              text: config.WELCOME_MESSAGE(`@${participant.split("@")[0]}`, `@${ownerNum}`),
              mentions: [participant, config.OWNER_NUMBER],
            });
            console.log(`[ترحيب] اترسلت رسالة الترحيب لـ ${participant} بنجاح.`);
          } catch (e) {
            // بنفصل الأخطاء لكل عضو لوحده عشان عضو واحد بس مايوقفش الترحيب
            // بباقي الأعضاء لو حصل خطأ غير متوقع
            console.error(`[ترحيب] خطأ في الترحيب بالعضو ${participant}:`, e.message);
          }
        }
      }

      if (action === "remove") {
        for (const participant of participants) {
          // -------- حماية صاحب البوت أو أي بوت تاني محمي --------
          // بتتأكد بالـ LID مش بس الرقم العادي (زي isOwner بالظبط) عشان
          // الحماية متتفلتش. لو حد (حتى لو أدمن) حاول يطرد رقم محمي، بيترجع
          // الرقم فورًا وبيتطرد اللي عمل كده بدل منه.
          const isProtected = await permissions.isProtectedNumber(sock, participant);
          if (isProtected && authorNum !== ownerNum) {
            const isOwnerCase = await permissions.isOwner(sock, participant);
            await sock.sendMessage(groupId, {
              text: style.danger(
                `متهزرش مع المسؤل 👑\n` +
                  `حد حاول يطرد ${isOwnerCase ? "صاحب البوت" : "بوت محمي"}! تم إرجاعه فورًا` +
                  (author ? ` وطرد @${author.split("@")[0]} بدل منه.` : ".")
              ),
              mentions: author ? [author] : [],
            });
            try {
              await sock.groupParticipantsUpdate(groupId, [participant], "add");
            } catch (e) {
              console.log("مقدرتش أرجع الرقم المحمي (لازم يكون البوت أدمن):", e.message);
            }
            if (author && authorNum !== ownerNum) {
              try {
                await sock.groupParticipantsUpdate(groupId, [author], "remove");
              } catch (e) {
                console.log("مقدرتش أطرد اللي حاول يطرد رقم محمي:", e.message);
              }
            }
          } else if (participant === author) {
            // الشخص خرج بنفسه (مش اترفد)
            await sock.sendMessage(groupId, {
              text: config.GOODBYE_MESSAGE(`@${participant.split("@")[0]}`),
              mentions: [participant],
            });
          }
        }
      }
    } catch (err) {
      console.error("خطأ في تحديث الأعضاء:", err);
    }
  });

  // ================= لما البوت يتضاف لجروب جديد (حماية من الإضافة غصب) =================
  sock.ev.on("groups.upsert", async (groups) => {
    for (const group of groups) {
      if (knownGroupIds.has(group.id)) continue; // جروب قديم، مش جديد فعلاً
      knownGroupIds.add(group.id);
      try {
        await sock.sendMessage(config.OWNER_NUMBER, {
          text: `ℹ️ تم إضافة البوت لجروب جديد: "${group.subject}".\nلو مش انت اللي ضفته، اطرد البوت من الجروب يدوي.`,
        });
      } catch (e) {
        console.error("خطأ في تنبيه الإضافة الجديدة:", e.message);
      }
    }
  });
}

async function handleViolation(sock, groupId, sender, botIsAdmin, warningTemplate, label) {
  const count = storage.addWarn(groupId, sender);
  if (count >= config.MAX_WARNINGS) {
    await sock.sendMessage(groupId, {
      text: style.danger(`${style.mention(sender)} اتطرد بسبب (${label}) بعد تجاوز عدد التحذيرات.`),
      mentions: [sender],
    });
    if (botIsAdmin) {
      await sock.groupParticipantsUpdate(groupId, [sender], "remove");
    }
    storage.resetWarn(groupId, sender);
  } else {
    await sock.sendMessage(groupId, {
      text: style.warn(`${style.mention(sender)} ${warningTemplate.replace("%COUNT%", count)}`),
      mentions: [sender],
    });
  }
}

startBot();
