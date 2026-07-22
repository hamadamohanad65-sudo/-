const config = require("./config");
const fs = require("fs");
const storage = require("./storage");
const games = require("./games");
const downloaders = require("./downloaders");
const statusSaver = require("./statusSaver");
const permissions = require("./permissions");
const banlist = require("./banlist");
const groupSettings = require("./groupSettings");
const scheduler = require("./scheduler");
const style = require("./style");
const decorate = require("./decorate");
const chat = require("./chat");

function numberOf(jid) {
  if (!jid) return null;
  return jid.split("@")[0].split(":")[0].replace(/\D/g, "");
}
const OWNER_NUM = numberOf(config.OWNER_NUMBER);

// ---------------- عداد تنازلي حي (بيعدّل نفس الرسالة كل شوية بدل ما يبعت رسالة واحدة بس آخر الوقت) ----------------
function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const parts = h > 0 ? [h, m, sec] : [m, sec];
  return parts.map((n) => String(n).padStart(2, "0")).join(":");
}

// بيبعت رسالة، وبعدين يعدّلها كل فترة زمنية (تختلف حسب طول المدة) وهو نازل
// لحد ما يوصل صفر، وبعدين يرجع بعد ما يخلص عشان تنفّذ العملية المطلوبة.
// titleFn(remainingSeconds) لازم ترجع النص اللي يتكتب في الرسالة عند كل تحديث.
async function runLiveCountdown(sock, groupId, totalSeconds, titleFn) {
  const tickMs = totalSeconds <= 60 ? 5000 : totalSeconds <= 600 ? 15000 : 30000;
  const sent = await sock.sendMessage(groupId, { text: titleFn(totalSeconds) });
  let remaining = totalSeconds;

  return new Promise((resolve) => {
    const interval = setInterval(async () => {
      remaining -= Math.round(tickMs / 1000);
      const done = remaining <= 0;
      try {
        await sock.sendMessage(groupId, { text: titleFn(done ? 0 : remaining), edit: sent.key });
      } catch (e) {
        console.error("خطأ في تحديث العداد التنازلي:", e.message);
      }
      if (done) {
        clearInterval(interval);
        resolve();
      }
    }, tickMs);
  });
}

async function handleCommand(sock, ctx) {
  const {
    command, args, groupId, sender, senderIsOwner, senderIsAdmin,
    canManage, botIsAdmin, participants, getTargetUser, quotedMsg,
    downloadQuotedMedia, quotedType,
  } = ctx;

  try {
    return await runCommand(sock, ctx);
  } catch (err) {
    console.error(`خطأ في تنفيذ الأمر "${command}":`, err);
    await sock.sendMessage(groupId, {
      text: "❌ حصل خطأ في تنفيذ الأمر. تأكد إن البوت لسه أدمن وعضو في الجروب، أو جرب تاني كمان شوية.",
    });
  }
}

async function runCommand(sock, ctx) {
  const {
    command, args, groupId, sender, senderIsOwner, senderIsAdmin,
    canManage, botIsAdmin, participants, getTargetUser, quotedMsg,
    downloadQuotedMedia, quotedType,
  } = ctx;

  switch (command) {
    // ---------------- طرد ----------------
    case "طرد":
    case "kick": {
      if (!canManage) return sock.sendMessage(groupId, { text: "الأمر ده للأدمنز بس." });
      if (!botIsAdmin) return sock.sendMessage(groupId, { text: "لازم تعمل البوت أدمن الأول." });
      const target = getTargetUser();
      if (!target) return sock.sendMessage(groupId, { text: "منشن الشخص أو رد على رسالته مع الأمر ده." });

      // -------- حماية صاحب البوت / أي بوت تاني محمي --------
      // بتتأكد بالـ LID مش بس الرقم العادي، عشان الحماية متتفلتش. ولو حد
      // (حتى لو أدمن ومعاه صلاحية) حاول يطرد رقم محمي، هو اللي هيتطرد بدل منه.
      if (!senderIsOwner && (await permissions.isProtectedNumber(sock, target))) {
        await sock.sendMessage(groupId, {
          text: style.danger(`متهزرش مع المسؤول 👑\nمينفعش تطرد الرقم ده، فهتتطرد انت بداله.`),
        });
        try {
          await sock.groupParticipantsUpdate(groupId, [sender], "remove");
        } catch (e) {
          console.log("مقدرتش أطرد اللي حاول يطرد رقم محمي:", e.message);
        }
        return;
      }

      await sock.groupParticipantsUpdate(groupId, [target], "remove");
      await sock.sendMessage(groupId, { text: style.success(`تم طرد @${target.split("@")[0]}`), mentions: [target] });
      break;
    }

    // ---------------- تحذير يدوي ----------------
    case "تحذير":
    case "warn": {
      if (!canManage) return;
      const target = getTargetUser();
      if (!target) return sock.sendMessage(groupId, { text: "منشن الشخص أو رد على رسالته." });
      if (!senderIsOwner && (await permissions.isProtectedNumber(sock, target))) {
        await sock.sendMessage(groupId, { text: style.danger("متهزرش مع المسؤول 👑 الرقم ده محمي.") });
        return;
      }
      const count = storage.addWarn(groupId, target);
      await sock.sendMessage(groupId, { text: style.warn(`تحذير رقم ${count} لـ @${target.split("@")[0]}`), mentions: [target] });
      if (count >= config.MAX_WARNINGS && botIsAdmin) {
        await sock.groupParticipantsUpdate(groupId, [target], "remove");
        storage.resetWarn(groupId, target);
        await sock.sendMessage(groupId, { text: style.danger(`تم طرد @${target.split("@")[0]} بعد تجاوز عدد التحذيرات.`), mentions: [target] });
      }
      break;
    }

    // ---------------- مسح تحذير ----------------
    case "مسح_تحذير": {
      if (!canManage) return;
      const target = getTargetUser();
      if (!target) return sock.sendMessage(groupId, { text: "منشن الشخص أو رد على رسالته." });
      storage.resetWarn(groupId, target);
      await sock.sendMessage(groupId, { text: `تم مسح تحذيرات @${target.split("@")[0]} ✅`, mentions: [target] });
      break;
    }

    // ---------------- التحكم في قايمة المسموح لهم يستخدموا البوت (صاحب البوت بس) ----------------
    case "اشراف": {
      if (!senderIsOwner) {
        return sock.sendMessage(groupId, { text: "الأمر ده لصاحب البوت بس." });
      }
      const p = config.PREFIXES[0];
      const sub = (args[0] || "").trim();
      const target = getTargetUser();

      if (sub === "اضافه" || sub === "اضافة" || sub === "add") {
        if (!target) {
          return sock.sendMessage(groupId, {
            text: `منشن الشخص أو رد على رسالته مع الأمر، مثلاً:\n${p}اشراف اضافه @الشخص`,
          });
        }
        const added = permissions.addAllowed(target);
        await sock.sendMessage(groupId, {
          text: added
            ? `✅ تم إضافة @${target.split("@")[0]} لقايمة المسموح لهم يستخدموا أوامر البوت.`
            : `@${target.split("@")[0]} أصلاً موجود في القايمة.`,
          mentions: [target],
        });
        break;
      }

      if (sub === "ازاله" || sub === "ازالة" || sub === "remove") {
        if (!target) {
          return sock.sendMessage(groupId, {
            text: `منشن الشخص أو رد على رسالته مع الأمر، مثلاً:\n${p}اشراف ازاله @الشخص`,
          });
        }
        if (target === config.OWNER_NUMBER || numberOf(target) === OWNER_NUM) {
          return sock.sendMessage(groupId, { text: "مينفعش تشيل صاحب البوت من القايمة 🚫" });
        }
        const removed = permissions.removeAllowed(target);
        await sock.sendMessage(groupId, {
          text: removed
            ? `✅ تم إزالة @${target.split("@")[0]} من قايمة المسموح لهم.`
            : `@${target.split("@")[0]} أصلاً مش موجود في القايمة.`,
          mentions: [target],
        });
        break;
      }

      if (sub === "قايمة" || sub === "list") {
        const list = permissions.listAllowed();
        if (list.length === 0) {
          return sock.sendMessage(groupId, {
            text: "قايمة المسموح لهم فاضية دلوقتي (صاحب البوت بس هو المسموح له يستخدم الأوامر).",
          });
        }
        const text = list.map((num, i) => `${i + 1}. ${num}`).join("\n");
        await sock.sendMessage(groupId, { text: `📋 قايمة المسموح لهم يستخدموا أوامر البوت:\n${text}` });
        break;
      }

      await sock.sendMessage(groupId, {
        text:
          `استخدم:\n` +
          `${p}اشراف اضافه (منشن/رد) - تضيف شخص للقايمة\n` +
          `${p}اشراف ازاله (منشن/رد) - تشيل شخص من القايمة\n` +
          `${p}اشراف قايمة - تعرض كل الأشخاص المسموح لهم`,
      });
      break;
    }

    // ---------------- حظر دائم (لو الشخص المحظور رجع الجروب هيتطرد فورًا) ----------------
    case "حظر": {
      if (!canManage) return sock.sendMessage(groupId, { text: "الأمر ده للأدمنز بس." });
      const target = getTargetUser();
      if (!target) return sock.sendMessage(groupId, { text: "منشن الشخص أو رد على رسالته مع الأمر ده." });
      if (target === config.OWNER_NUMBER || numberOf(target) === OWNER_NUM) {
        return sock.sendMessage(groupId, { text: "مينفعش تحظر صاحب البوت 🚫" });
      }
      const added = banlist.addBan(target);
      if (botIsAdmin) {
        try {
          await sock.groupParticipantsUpdate(groupId, [target], "remove");
        } catch (e) { /* ممكن يكون مش موجود في الجروب أصلاً */ }
      }
      await sock.sendMessage(groupId, {
        text: added
          ? style.success(`تم حظر @${target.split("@")[0]} نهائيًا. لو حاول يرجع أي جروب هيتطرد أوتوماتيك.`)
          : `@${target.split("@")[0]} أصلاً محظور.`,
        mentions: [target],
      });
      break;
    }
    case "الغاء_حظر":
    case "الغاء_الحظر": {
      if (!canManage) return sock.sendMessage(groupId, { text: "الأمر ده للأدمنز بس." });
      const target = getTargetUser();
      if (!target) return sock.sendMessage(groupId, { text: "منشن الشخص أو رد على رسالته مع الأمر ده." });
      const removed = banlist.removeBan(target);
      await sock.sendMessage(groupId, {
        text: removed
          ? style.success(`تم إلغاء حظر @${target.split("@")[0]}.`)
          : `@${target.split("@")[0]} أصلاً مش محظور.`,
        mentions: [target],
      });
      break;
    }
    case "المحظورين": {
      const list = banlist.listBanned();
      if (list.length === 0) return sock.sendMessage(groupId, { text: "مفيش حد محظور دلوقتي." });
      const text = list.map((num, i) => `${i + 1}. ${num}`).join("\n");
      await sock.sendMessage(groupId, { text: `🚫 قايمة المحظورين نهائيًا:\n${text}` });
      break;
    }

    // ---------------- عرض مشرفين الجروب ----------------
    case "المشرفين":
    case "الادمن":
    case "admins": {
      const admins = participants.filter((p) => p.admin === "admin" || p.admin === "superadmin");
      if (admins.length === 0) {
        return sock.sendMessage(groupId, { text: "مفيش مشرفين في الجروب ده حاليًا (غريبة!)." });
      }
      const mentions = admins.map((a) => a.id);
      const text = admins
        .map((a, i) => `${i + 1}. @${a.id.split("@")[0]}${a.admin === "superadmin" ? " 👑 (سوبر أدمن)" : ""}`)
        .join("\n");
      await sock.sendMessage(groupId, { text: `👮 مشرفين الجروب:\n${text}`, mentions });
      break;
    }

    // ---------------- القائمة السودة (عرض التحذيرات) ----------------
    case "القائمة_السوداء": {
      const groupWarns = storage.warnings[groupId] || {};
      const entries = Object.entries(groupWarns).filter(([, c]) => c > 0);
      if (entries.length === 0) return sock.sendMessage(groupId, { text: "مفيش حد عليه تحذيرات دلوقتي 🎉" });
      const mentions = entries.map(([id]) => id);
      const text = entries.map(([id, c]) => `@${id.split("@")[0]} - ${c} تحذير`).join("\n");
      await sock.sendMessage(groupId, { text: `⚠️ قائمة التحذيرات:\n${text}`, mentions });
      break;
    }

    // ---------------- ترقية / نزع أدمن ----------------
    case "ترقيه":
    case "ترقية":
    case "promote": {
      if (!canManage || !botIsAdmin) return;
      const target = getTargetUser();
      if (!target) return sock.sendMessage(groupId, { text: "منشن الشخص أو رد على رسالته." });
      await sock.groupParticipantsUpdate(groupId, [target], "promote");
      await sock.sendMessage(groupId, { text: `تم ترقية @${target.split("@")[0]} لأدمن ✅`, mentions: [target] });
      break;
    }
    case "نزع": {
      if (!canManage || !botIsAdmin) return;
      const target = getTargetUser();
      if (!target) return sock.sendMessage(groupId, { text: "منشن الشخص أو رد على رسالته." });
      if (target === config.OWNER_NUMBER || numberOf(target) === OWNER_NUM) return sock.sendMessage(groupId, { text: "مينفعش تنزع صاحب البوت 🚫" });
      await sock.groupParticipantsUpdate(groupId, [target], "demote");
      await sock.sendMessage(groupId, { text: `تم نزع الأدمن عن @${target.split("@")[0]} ✅`, mentions: [target] });
      break;
    }

    // ---------------- تغيير اسم / وصف الجروب ----------------
    case "اسم": {
      if (!canManage || !botIsAdmin) return;
      const newName = args.join(" ");
      if (!newName) return sock.sendMessage(groupId, { text: `اكتب: ${config.PREFIXES[0]}اسم <الاسم الجديد>` });
      await sock.groupUpdateSubject(groupId, newName);
      await sock.sendMessage(groupId, { text: style.success(`تم تغيير اسم الجروب لـ: ${newName}`) });
      break;
    }
    case "وصف": {
      if (!canManage || !botIsAdmin) return;
      const newDesc = args.join(" ");
      if (!newDesc) return sock.sendMessage(groupId, { text: `اكتب: ${config.PREFIXES[0]}وصف <الوصف الجديد>` });
      await sock.groupUpdateDescription(groupId, newDesc);
      await sock.sendMessage(groupId, { text: style.success("تم تغيير وصف الجروب.") });
      break;
    }

    // ---------------- تغيير صورة الجروب (رد على صورة) ----------------
    case "صورة_الجروب":
    case "تغيير_الصورة": {
      if (!canManage || !botIsAdmin) return sock.sendMessage(groupId, { text: "لازم تكون أدمن والبوت أدمن كمان." });
      if (quotedType !== "imageMessage") {
        return sock.sendMessage(groupId, { text: `رد على صورة بالأمر ${config.PREFIXES[0]}صورة_الجروب.` });
      }
      try {
        const buffer = await downloadQuotedMedia();
        await downloaders.changeGroupPicture(sock, groupId, buffer);
        await sock.sendMessage(groupId, { text: style.success("تم تغيير صورة الجروب.") });
      } catch (e) {
        console.error("خطأ في تغيير صورة الجروب:", e.message);
        await sock.sendMessage(groupId, { text: "❌ مقدرتش أغيّر الصورة، جرب صورة تانية." });
      }
      break;
    }

    // ---------------- تحويل ملصق (استيكر) لصورة عادية (رد على ملصق) ----------------
    case "تحويل":
    case "ملصق_لصورة":
    case "استيكر_لصورة":
    case "sticker2image": {
      if (quotedType !== "stickerMessage") {
        return sock.sendMessage(groupId, {
          text: `رد على ملصق (استيكر) بالأمر ${config.PREFIXES[0]}تحويل عشان أحوّله لصورة عادية.`,
        });
      }
      try {
        const webpBuffer = await downloadQuotedMedia();
        const pngBuffer = await downloaders.convertStickerToImage(webpBuffer);
        await sock.sendMessage(groupId, { image: pngBuffer, caption: "✅ اتفضل الصورة" });
      } catch (e) {
        console.error("خطأ في تحويل الملصق:", e.message);
        await sock.sendMessage(groupId, {
          text: "❌ مقدرتش أحوّل الملصق. لازم مكتبة sharp تكون متثبتة (npm install).",
        });
      }
      break;
    }

    // ---------------- إضافة رقم للجروب مباشرة ----------------
    case "اضافة":
    case "اضافه": {
      if (!canManage || !botIsAdmin) return sock.sendMessage(groupId, { text: "لازم تكون أدمن والبوت أدمن كمان." });
      const rawNumber = (args[0] || "").replace(/\D/g, "");
      if (!rawNumber) return sock.sendMessage(groupId, { text: `اكتب: ${config.PREFIXES[0]}اضافة <الرقم بالصيغة الدولية>` });
      const jid = `${rawNumber}@s.whatsapp.net`;
      try {
        const result = await sock.groupParticipantsUpdate(groupId, [jid], "add");
        const status = result?.[0]?.status;
        if (status === "200") {
          await sock.sendMessage(groupId, { text: style.success(`تم إضافة @${rawNumber} للجروب.`), mentions: [jid] });
        } else {
          await sock.sendMessage(groupId, {
            text: `⚠️ مقدرتش أضيف الرقم مباشرة (ممكن إعدادات الخصوصية بتاعته مانعة). جرب تبعتله لينك الجروب بدل كده.`,
          });
        }
      } catch (e) {
        console.error("خطأ في إضافة رقم:", e.message);
        await sock.sendMessage(groupId, { text: "❌ حصل خطأ في محاولة الإضافة." });
      }
      break;
    }

    // ---------------- تفعيل / تعطيل رسالة الترحيب لهذا الجروب + إرسالها يدويًا ----------------
    // الترحيب شغال بطريقتين:
    // 1) تلقائي: بمجرد ما تشغّله بـ "الترحيب تشغيل"، هيترسل لوحده لأي عضو جديد يدخل الجروب.
    // 2) يدوي: تقدر تبعتها بنفسك في أي وقت لأي شخص بأمر "الترحيب ارسال" (منشن أو رد).
    case "الترحيب": {
      if (!canManage) return sock.sendMessage(groupId, { text: "الأمر ده للأدمنز بس." });
      const sub = (args[0] || "").trim();

      if (sub === "تشغيل" || sub === "on") {
        groupSettings.setWelcomeEnabled(groupId, true);
        return sock.sendMessage(groupId, {
          text: style.success("تم تفعيل رسالة الترحيب في الجروب ده، هتترسل أوتوماتيك لأي عضو جديد."),
        });
      }
      if (sub === "تعطيل" || sub === "off") {
        groupSettings.setWelcomeEnabled(groupId, false);
        return sock.sendMessage(groupId, { text: style.success("تم تعطيل رسالة الترحيب في الجروب ده.") });
      }

      // -------- إرسال رسالة الترحيب يدويًا (منشن/رد)، بغض النظر عن حالة التفعيل التلقائي --------
      if (sub === "ارسال" || sub === "إرسال" || sub === "ابعت" || sub === "send") {
        const target = getTargetUser() || sender; // لو مفيش تارجت، ابعتها له هو كتجربة
        await sock.sendMessage(groupId, {
          text: config.WELCOME_MESSAGE(`@${target.split("@")[0]}`, `@${OWNER_NUM}`),
          mentions: [target, config.OWNER_NUMBER],
        });
        break;
      }

      await sock.sendMessage(groupId, {
        text:
          `استخدم:\n${config.PREFIXES[0]}الترحيب تشغيل\n${config.PREFIXES[0]}الترحيب تعطيل\n` +
          `${config.PREFIXES[0]}الترحيب ارسال (منشن/رد) - يبعت رسالة الترحيب يدويًا دلوقتي`,
      });
      break;
    }

    // ---------------- حظر أي رابط (مش بس روابط دعوة جروبات واتساب) + طرد فوري ----------------
    // البوت أصلاً بيحذف ويطرد فورًا أي حد يبعت رابط دعوة جروب واتساب
    // (chat.whatsapp.com/wa.me) لكل الأعضاء (حتى الأدمنز، ما عدا صاحب
    // البوت)، طول ما البوت أدمن. الأمر ده بيوسّع الحظر ده ليشمل أي رابط
    // عادي كمان (يوتيوب/انستجرام/تيك توك/أي حاجة فيها http أو www) -
    // شغال افتراضيًا في كل الجروبات.
    case "حظر_الروابط": {
      if (!canManage) return sock.sendMessage(groupId, { text: "الأمر ده للأدمنز بس." });
      const sub = (args[0] || "").trim();

      if (sub === "تشغيل" || sub === "on") {
        groupSettings.setBlockAllLinks(groupId, true);
        return sock.sendMessage(groupId, {
          text: style.success(
            "تم تفعيل حظر كل الروابط في الجروب ده. أي حد (حتى الأدمنز، ما عدا صاحب البوت) يبعت أي رابط هيتطرد فورًا (لازم البوت يكون أدمن)."
          ),
        });
      }
      if (sub === "تعطيل" || sub === "off") {
        groupSettings.setBlockAllLinks(groupId, false);
        return sock.sendMessage(groupId, {
          text: style.success(
            "تم تعطيل حظر كل الروابط. لسه هيتم حظر وطرد أي حد يبعت رابط دعوة جروب واتساب بس."
          ),
        });
      }

      const enabled = groupSettings.isBlockAllLinksEnabled(groupId);
      await sock.sendMessage(groupId, {
        text:
          `الحالة الحالية: ${enabled ? "✅ حظر كل الروابط شغال" : "⏸️ بس روابط دعوة الجروبات محظورة"}\n\n` +
          `استخدم:\n${config.PREFIXES[0]}حظر الروابط تشغيل\n${config.PREFIXES[0]}حظر الروابط تعطيل`,
      });
      break;
    }

    // ---------------- قوانين الجروب (رسالة ثابتة تتبعت وقت ما حد يطلبها) ----------------
    case "القوانين": {
      const rules = groupSettings.getRules(groupId);
      if (!rules) {
        return sock.sendMessage(groupId, {
          text: `مفيش قوانين متسجلة للجروب ده لسه.\nالأدمن يقدر يسجلها بـ:\n${config.PREFIXES[0]}تعيين_القوانين <النص>`,
        });
      }
      await sock.sendMessage(groupId, { text: style.box("قوانين الجروب", rules) });
      break;
    }
    case "تعيين_القوانين": {
      if (!canManage) return sock.sendMessage(groupId, { text: "الأمر ده للأدمنز بس." });
      const text = args.join(" ");
      if (!text) return sock.sendMessage(groupId, { text: `اكتب: ${config.PREFIXES[0]}تعيين_القوانين <نص القوانين>` });
      groupSettings.setRules(groupId, text);
      await sock.sendMessage(groupId, { text: style.success("تم تسجيل قوانين الجروب. تقدر تعرضها بـ .القوانين") });
      break;
    }

    // ---------------- تصويت / استفتاء ----------------
    // .تصويت السؤال / خيار1 / خيار2 / خيار3...
    case "تصويت": {
      if (storage.hasActivePoll(groupId)) {
        return sock.sendMessage(groupId, {
          text: `فيه تصويت شغال أصلاً! استخدم ${config.PREFIXES[0]}صوت <رقم> عشان تصوّت، أو ${config.PREFIXES[0]}انهاء_التصويت لإنهائه.`,
        });
      }
      const raw = args.join(" ");
      const parts = raw.split("/").map((s) => s.trim()).filter(Boolean);
      if (parts.length < 3) {
        return sock.sendMessage(groupId, {
          text: `اكتب: ${config.PREFIXES[0]}تصويت السؤال / خيار1 / خيار2 / خيار3 (لغاية 10 خيارات)`,
        });
      }
      const question = parts[0];
      const options = parts.slice(1, 11);
      storage.startPoll(groupId, question, options);
      const optionsText = options.map((o, i) => `${i + 1}. ${o}`).join("\n");
      await sock.sendMessage(groupId, {
        text: style.box("🗳️ تصويت جديد", [
          question,
          "",
          optionsText,
          "",
          `صوّت بكتابة: ${config.PREFIXES[0]}صوت <رقم>`,
        ]),
      });
      break;
    }
    case "صوت": {
      if (!storage.hasActivePoll(groupId)) {
        return sock.sendMessage(groupId, { text: "مفيش تصويت شغال دلوقتي." });
      }
      const idx = parseInt((args[0] || "").trim(), 10) - 1;
      if (isNaN(idx)) return sock.sendMessage(groupId, { text: `اكتب: ${config.PREFIXES[0]}صوت <رقم الخيار>` });
      const ok = storage.castVote(groupId, sender, idx);
      if (!ok) return sock.sendMessage(groupId, { text: "رقم الخيار ده مش موجود في التصويت." });
      await sock.sendMessage(groupId, { text: style.success("تم تسجيل صوتك ✅") });
      break;
    }
    case "نتيجة_التصويت": {
      const results = storage.getPollResults(groupId);
      if (!results) return sock.sendMessage(groupId, { text: "مفيش تصويت شغال دلوقتي." });
      const text = results.options
        .map((o, i) => `${i + 1}. ${o} - ${results.counts[i]} صوت`)
        .join("\n");
      await sock.sendMessage(groupId, { text: style.box(`نتيجة: ${results.question}`, text) });
      break;
    }
    case "انهاء_التصويت": {
      if (!canManage) return sock.sendMessage(groupId, { text: "الأمر ده للأدمنز بس." });
      const results = storage.endPoll(groupId);
      if (!results) return sock.sendMessage(groupId, { text: "مفيش تصويت شغال دلوقتي." });
      const total = results.counts.reduce((a, b) => a + b, 0);
      const text = results.options
        .map((o, i) => `${i + 1}. ${o} - ${results.counts[i]} صوت`)
        .join("\n");
      await sock.sendMessage(groupId, {
        text: style.box(`🏁 النتيجة النهائية: ${results.question}`, [text, "", `إجمالي الأصوات: ${total}`]),
      });
      break;
    }

    // ---------------- رسايل مجدولة (تتبعت أوتوماتيك كل يوم في وقت معين) ----------------
    case "جدولة": {
      if (!canManage) return sock.sendMessage(groupId, { text: "الأمر ده للأدمنز بس." });
      const p = config.PREFIXES[0];
      const sub = (args[0] || "").trim();

      if (sub === "اضافه" || sub === "اضافة" || sub === "add") {
        const time = args[1];
        const text = args.slice(2).join(" ");
        if (!time || !text || !scheduler.isValidTime(time)) {
          return sock.sendMessage(groupId, {
            text: `اكتب: ${p}جدولة اضافه <HH:MM> <النص>\nمثال: ${p}جدولة اضافه 09:00 صباح الخير يا جماعة ☀️`,
          });
        }
        scheduler.addSchedule(groupId, time, text);
        await sock.sendMessage(groupId, { text: style.success(`تم جدولة رسالة الساعة ${time} كل يوم.`) });
        break;
      }

      if (sub === "قايمة" || sub === "list") {
        const list = scheduler.listSchedules(groupId);
        if (list.length === 0) return sock.sendMessage(groupId, { text: "مفيش رسايل مجدولة في الجروب ده." });
        const text = list.map((s, i) => `${i + 1}. ${s.time} - ${s.text}`).join("\n");
        await sock.sendMessage(groupId, { text: `⏰ الرسايل المجدولة:\n${text}` });
        break;
      }

      if (sub === "حذف" || sub === "remove") {
        const idx = parseInt(args[1], 10) - 1;
        if (isNaN(idx)) return sock.sendMessage(groupId, { text: `اكتب: ${p}جدولة حذف <رقم الرسالة من القايمة>` });
        const removed = scheduler.removeSchedule(groupId, idx);
        await sock.sendMessage(groupId, {
          text: removed ? style.success("تم حذف الرسالة المجدولة.") : "الرقم ده مش موجود.",
        });
        break;
      }

      await sock.sendMessage(groupId, {
        text:
          `استخدم:\n` +
          `${p}جدولة اضافه <HH:MM> <النص> - تضيف رسالة يومية\n` +
          `${p}جدولة قايمة - تعرض كل الرسايل المجدولة\n` +
          `${p}جدولة حذف <رقم> - تشيل رسالة من القايمة`,
      });
      break;
    }

    // ---------------- كتم / فك كتم الجروب ----------------
    case "كتم":
    case "mute": {
      if (!canManage || !botIsAdmin) return;
      await sock.groupSettingUpdate(groupId, "announcement");
      await sock.sendMessage(groupId, { text: "🔇 تم كتم الجروب، الأدمنز بس يقدروا يبعتوا رسايل." });
      break;
    }
    case "فك_كتم":
    case "unmute": {
      if (!canManage || !botIsAdmin) return;
      await sock.groupSettingUpdate(groupId, "not_announcement");
      await sock.sendMessage(groupId, { text: "🔊 تم فك الكتم، الكل يقدر يبعت تاني." });
      break;
    }

    // ---------------- قفل / فتح تعديل معلومات الجروب ----------------
    case "قفل": {
      if (!canManage || !botIsAdmin) return;
      await sock.groupSettingUpdate(groupId, "locked");
      await sock.sendMessage(groupId, { text: "🔒 دلوقتي الأدمنز بس يقدروا يغيّروا اسم/صورة/وصف الجروب." });
      break;
    }
    case "فتح": {
      if (!canManage || !botIsAdmin) return;
      await sock.groupSettingUpdate(groupId, "unlocked");
      await sock.sendMessage(groupId, { text: "🔓 دلوقتي أي حد يقدر يغيّر معلومات الجروب." });
      break;
    }

    // ---------------- موقت / تايمر (عداد تنازلي حي، أو قفل الجروب لمدة معينة) ----------------
    // .موقت <ثواني>       -> عداد تنازلي حي بيتحدّث كل شوية لحد ما يوصل صفر
    // .موقت غلق <ثواني>   -> يكتم الجروب المدة دي مع عداد حي، وبعدين يفتحه تلقائي
    case "موقت":
    case "timer": {
      const p = config.PREFIXES[0];
      const sub = (args[0] || "").trim();

      // ---- .موقت غلق <ثواني> ----
      if (sub === "غلق" || sub === "قفل") {
        if (!canManage || !botIsAdmin) return;
        const seconds = parseInt(args[1], 10);
        if (!seconds || seconds <= 0) {
          return sock.sendMessage(groupId, { text: `اكتب: ${p}موقت غلق <عدد الثواني>\nمثال: ${p}موقت غلق 300 (يقفل 5 دقايق)` });
        }
        // لو فيه قفل مؤقت شغال أصلاً على نفس الجروب، نلغيه ونبدأ من جديد
        if (storage.activeLocks[groupId]) storage.activeLocks[groupId]();

        await sock.groupSettingUpdate(groupId, "announcement");

        let cancelled = false;
        storage.activeLocks[groupId] = () => {
          cancelled = true;
        };

        await runLiveCountdown(sock, groupId, seconds, (remaining) =>
          remaining > 0
            ? style.info(`🔒 الجروب مقفول (الأدمنز بس يقدروا يبعتوا).\nهيتفتح تلقائي بعد: ⏱️ ${formatDuration(remaining)}`)
            : style.success("🔓 خلصت مدة القفل، الجروب اتفتح تاني وكل حد يقدر يبعت.")
        );

        if (cancelled) break; // اتلغى القفل ده بقفل جديد قبل ما يخلص، مانفتحش من هنا
        delete storage.activeLocks[groupId];
        try {
          await sock.groupSettingUpdate(groupId, "not_announcement");
        } catch (e) {
          console.error("خطأ في فتح الجروب بعد انتهاء المؤقت:", e.message);
        }
        break;
      }

      // ---- .موقت <ثواني> (عداد تنازلي حي) ----
      const seconds = parseInt(sub, 10);
      if (!seconds || seconds <= 0) {
        return sock.sendMessage(groupId, {
          text: `استخدم:\n${p}موقت <عدد الثواني> - عداد تنازلي حي وبيبعت رسالة لما يخلص\n${p}موقت غلق <عدد الثواني> - يقفل الجروب المدة دي وبعدين يفتحه تلقائي`,
        });
      }
      await runLiveCountdown(sock, groupId, seconds, (remaining) =>
        remaining > 0 ? style.info(`⏱️ العداد: ${formatDuration(remaining)} متبقي...`) : style.success("⏰ خلص الوقت!")
      );
      await sock.sendMessage(groupId, {
        text: style.success(`⏰ خلص الوقت! - @${sender.split("@")[0]}`),
        mentions: [sender],
      });
      break;
    }

    // ---------------- طرد الخاملين ----------------
    case "طرد_الخاملين": {
      if (!canManage || !botIsAdmin) return;
      const days = parseInt(args[0], 10) || config.INACTIVE_DAYS_DEFAULT;
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
      const groupActivity = storage.lastActive[groupId] || {};

      const senderNum = numberOf(sender);
      const inactive = participants
        .map((p) => p.id)
        .filter((id) => numberOf(id) !== senderNum && numberOf(id) !== OWNER_NUM)
        .filter((id) => !groupActivity[id] || groupActivity[id] < cutoff);

      if (inactive.length === 0) {
        return sock.sendMessage(groupId, { text: `مفيش حد خامل من غير نشاط أكتر من ${days} يوم.` });
      }
      await sock.sendMessage(groupId, {
        text: `⏳ هيتم طرد ${inactive.length} عضو خامل من غير نشاط أكتر من ${days} يوم...`,
      });
      for (const id of inactive) {
        try {
          await sock.groupParticipantsUpdate(groupId, [id], "remove");
        } catch (e) { /* تجاهل لو حصل خطأ في شخص معين */ }
      }
      break;
    }

    // ---------------- تصفية الجروب (طرد الكل ما عدا الأونر والبوت) ----------------
    case "تصفية":
    case "purge": {
      if (!senderIsOwner) return sock.sendMessage(groupId, { text: "الأمر ده لصاحب البوت بس." });
      if (!botIsAdmin) return sock.sendMessage(groupId, { text: "لازم تعمل البوت أدمن الأول." });

      const senderNum = numberOf(sender);
      const botNumCandidates = [
        sock.user?.id,
        sock.user?.lid,
        sock.authState?.creds?.me?.id,
        sock.authState?.creds?.me?.lid,
      ]
        .filter(Boolean)
        .map(numberOf);

      const toRemove = participants
        .map((p) => p.id)
        .filter((id) => numberOf(id) !== senderNum && !botNumCandidates.includes(numberOf(id)));

      if (toRemove.length === 0) {
        return sock.sendMessage(groupId, { text: "مفيش حد للطرد، الجروب فاضي أصلاً من الأعضاء الزيادة." });
      }

      await sock.sendMessage(groupId, {
        text: `🧹 جاري تصفية الجروب... هيتطرد ${toRemove.length} عضو.`,
      });

      let removedCount = 0;
      const batchSize = 20;
      for (let i = 0; i < toRemove.length; i += batchSize) {
        const batch = toRemove.slice(i, i + batchSize);
        try {
          await sock.groupParticipantsUpdate(groupId, batch, "remove");
          removedCount += batch.length;
        } catch (e) {
          console.error("فشل طرد دفعة أعضاء أثناء التصفية:", e.message);
        }
        await new Promise((r) => setTimeout(r, 1500));
      }

      await sock.sendMessage(groupId, { text: `✅ تمت التصفية. اتطرد حوالي ${removedCount} عضو.` });
      break;
    }

    // ---------------- إحصائيات الجروب ----------------
    case "الاحصائيات":
    case "احصائيات": {
      const top = storage.getFullLeaderboard(groupId).slice(0, 10);
      if (top.length === 0) return sock.sendMessage(groupId, { text: "مفيش إحصائيات كفاية لسه." });
      const mentions = top.map(([id]) => id);
      const medals = ["👑", "🥈", "🥉"];
      const text = top
        .map(([id, c], i) => `${medals[i] || `${i + 1}.`} @${id.split("@")[0]} - ${c} رسالة`)
        .join("\n");
      await sock.sendMessage(groupId, { text: `📊 ترتيب الأعضاء حسب عدد الرسايل:\n${text}`, mentions });
      break;
    }
    case "الاحصائيات_كاملة": {
      const all = storage.getFullLeaderboard(groupId);
      if (all.length === 0) return sock.sendMessage(groupId, { text: "مفيش إحصائيات كفاية لسه." });
      const mentions = all.map(([id]) => id);
      const medals = ["👑", "🥈", "🥉"];
      const text = all
        .map(([id, c], i) => `${medals[i] || `${i + 1}.`} @${id.split("@")[0]} - ${c} رسالة`)
        .join("\n");
      await sock.sendMessage(groupId, { text: `📊 إحصائيات كل أعضاء الجروب:\n${text}`, mentions });
      break;
    }

    // ---------------- حسبة: رسايل اليوم / الأسبوع / الشهر ----------------
    case "حسبه":
    case "حسبة": {
      const target = getTargetUser() || sender;
      const today = storage.getPeriodCount(groupId, target, 1);
      const week = storage.getPeriodCount(groupId, target, 7);
      const month = storage.getPeriodCount(groupId, target, 30);
      await sock.sendMessage(groupId, {
        text:
          `📈 حسبة @${target.split("@")[0]}:\n` +
          `• النهاردة: ${today} رسالة\n` +
          `• آخر أسبوع: ${week} رسالة\n` +
          `• آخر شهر: ${month} رسالة`,
        mentions: [target],
      });
      break;
    }

    // ---------------- حسبة كلية: إجمالي + ترتيب + متوسط + مدة النشاط ----------------
    case "حسبه_كليه":
    case "حسبة_كلية": {
      const target = getTargetUser() || sender;
      const full = storage.getFullUserStats(groupId, target);
      if (!full) {
        return sock.sendMessage(groupId, { text: "مفيش إحصائيات كفاية لهذا الشخص لسه." });
      }
      await sock.sendMessage(groupId, {
        text:
          `📊 الحسبة الكلية لـ @${target.split("@")[0]}:\n` +
          `• إجمالي الرسايل: ${full.total}\n` +
          `• الترتيب: ${full.rank} من ${full.totalMembers}\n` +
          `• متوسط الرسايل يوميًا: ${full.average}\n` +
          `• مدة النشاط: ${full.durationDays} يوم`,
        mentions: [target],
      });
      break;
    }

    // ---------------- شكوى للأدمنز/صاحب البوت ----------------
    case "شكوى": {
      const complaint = args.join(" ");
      if (!complaint) return sock.sendMessage(groupId, { text: "اكتب الشكوى بعد الأمر، مثلاً: .شكوى فيه حد بيضايقني" });
      await sock.sendMessage(config.OWNER_NUMBER, {
        text: `📩 شكوى جديدة من @${sender.split("@")[0]} في جروب "${ctx.groupName}":\n${complaint}`,
        mentions: [sender],
      });
      await sock.sendMessage(groupId, { text: "تم إرسال شكواك لصاحب البوت ✅" });
      break;
    }

    // ================= الألعاب (7 ألعاب + تخمين الرقم الأصلية) =================
    case "لعبة": {
      if (games.isGameActive(groupId)) {
        return sock.sendMessage(groupId, {
          text: "فيه لعبة شغالة أصلاً! جاوب عليها الأول، أو اكتب .وقف_اللعبة عشان توقفها.",
        });
      }
      const gameName = (args[0] || "").trim();
      const p = config.PREFIXES[0];

      switch (gameName) {
        case "رقم": {
          games.startNumberGame(groupId);
          await sock.sendMessage(groupId, {
            text: `🎯 خمّن رقم من 1 لـ ${config.GAME_MAX_NUMBER}! ابعت رقمك كرسالة عادية.`,
          });
          break;
        }
        case "كلمة": {
          const word = games.startWordGame(groupId);
          await sock.sendMessage(groupId, {
            text: `🔤 خمّن الكلمة! عدد حروفها: ${word.length}\nابعت تخمينك كرسالة عادية.`,
          });
          break;
        }
        case "حساب": {
          const question = games.startMathGame(groupId);
          await sock.sendMessage(groupId, {
            text: `🧮 حل المعادلة دي بسرعة:\n${question} = ؟\nابعت الإجابة كرسالة عادية.`,
          });
          break;
        }
        case "صح_غلط": {
          const statement = games.startTrueFalseGame(groupId);
          await sock.sendMessage(groupId, {
            text: `❓ صح ولا غلط؟\n"${statement}"\nجاوب بكلمة "صح" أو "غلط".`,
          });
          break;
        }
        case "سؤال": {
          const item = games.startTriviaGame(groupId);
          const optionsText = item.options.map((o, i) => `${i + 1}. ${o}`).join("\n");
          await sock.sendMessage(groupId, {
            text: `🧠 ${item.q}\n${optionsText}\nابعت رقم الإجابة الصح.`,
          });
          break;
        }
        case "ترتيب": {
          const shuffled = games.startUnscrambleGame(groupId);
          await sock.sendMessage(groupId, {
            text: `🔀 رتّب الحروف دي عشان تطلع كلمة:\n${shuffled.split("").join(" ")}\nابعت الكلمة كاملة كإجابة.`,
          });
          break;
        }
        default: {
          await sock.sendMessage(groupId, {
            text:
              "🎮 الألعاب المتاحة (اختار واحدة):\n\n" +
              `${p}لعبة رقم - تخمين رقم من 1 لـ ${config.GAME_MAX_NUMBER}\n` +
              `${p}لعبة كلمة - تخمين كلمة\n` +
              `${p}لعبة حساب - حل معادلة بسرعة\n` +
              `${p}لعبة صح_غلط - صح ولا غلط\n` +
              `${p}لعبة سؤال - سؤال ثقافة عامة\n` +
              `${p}لعبة ترتيب - ترتيب حروف كلمة\n\n` +
              "🪨 ألعاب فورية (نتيجة على طول، من غير انتظار):\n" +
              `${p}حجر_ورقة_مقص <حجر/ورقة/مقص>\n` +
              `${p}النرد - ترمي نرد وتشوف طلع كام`,
          });
        }
      }
      break;
    }
    case "وقف_اللعبة": {
      if (!canManage) return;
      games.stopGame(groupId);
      await sock.sendMessage(groupId, { text: "تم إيقاف اللعبة." });
      break;
    }

    // ---------------- حجر ورقة مقص (فورية) ----------------
    case "حجر_ورقة_مقص":
    case "rps": {
      const choice = (args[0] || "").trim();
      const outcome = games.playRockPaperScissors(choice);
      if (!outcome) {
        return sock.sendMessage(groupId, {
          text: `اكتب: ${config.PREFIXES[0]}حجر_ورقة_مقص حجر (أو ورقة أو مقص)`,
        });
      }
      const resultText =
        outcome.result === "draw" ? "🤝 تعادل!" : outcome.result === "win" ? "🎉 كسبت!" : "😅 خسرت!";
      await sock.sendMessage(groupId, { text: `أنا اخترت: ${outcome.botChoice}\n${resultText}` });
      break;
    }

    // ---------------- النرد (فورية) ----------------
    case "النرد":
    case "زهر": {
      const roll = games.rollDice();
      await sock.sendMessage(groupId, { text: `🎲 طلع رقم: ${roll}` });
      break;
    }

    // ---------------- نسبة هزار عشوائية (منشن اختياري + كلمة مخصصة اختيارية) ----------------
    // - "نسبة" لوحدها ➜ تسمية عشوائية جاهزة (نسبة الجنان/الكسل/الحظ...)
    // - "نسبة جمال @شخص" ➜ بتستخدم الكلمة اللي كتبها المستخدم نفسها كتسمية
    //   ("نسبة جمال")، مش بس التسميات الجاهزة - أي كلمة يكتبها (جمال/عبط/أي حاجة)
    case "نسبة":
    case "نسبه": {
      const target = getTargetUser();
      // بنشيل أي منشن نصي (زي @201234567890) من الكلام عشان ناخد بس الكلمة
      // اللي المستخدم كتبها فعلاً كتسمية للنسبة
      const customWord = args.filter((w) => !w.startsWith("@")).join(" ").trim();
      const who = target ? ` @${target.split("@")[0]}` : "";

      const labelText = customWord ? `نسبة ${customWord}` : games.getFunPercentage().label;
      const percent = games.randomPercent();

      await sock.sendMessage(groupId, {
        text: `🎯 ${labelText}${who}: *${percent}%*`,
        mentions: target ? [target] : [],
      });
      break;
    }

    // ---------------- زخرفة نص (كتابة أو رد على رسالة) ----------------
    // - "زخرفه" لوحدها ➜ تعرض قائمة الـ 30 خط
    // - "زخرفه <نص>" ➜ تعرض كل الأشكال التلاتين مطبقة على النص
    // - "زخرفه 28" ردًا على رسالة ➜ تطبّق خط رقم 28 على الرسالة المردود عليها بس
    case "زخرفه":
    case "زخرفة":
    case "زخرف": {
      const firstArg = args[0];
      const isNumberChoice = args.length >= 1 && /^\d+$/.test(firstArg);

      if (isNumberChoice) {
        const textToStyle =
          args.slice(1).join(" ") ||
          quotedMsg?.conversation ||
          quotedMsg?.extendedTextMessage?.text ||
          "";
        if (!textToStyle) {
          return sock.sendMessage(groupId, {
            text: `رد على رسالة نصية بالأمر ${config.PREFIXES[0]}زخرفه ${firstArg}، أو اكتب النص بعد الرقم.`,
          });
        }
        const result = decorate.decorateOne(textToStyle, firstArg);
        if (!result) {
          return sock.sendMessage(groupId, { text: `اختار رقم من 1 لـ 30. اكتب ${config.PREFIXES[0]}زخرفه لوحدها عشان تشوف القايمة.` });
        }
        await sock.sendMessage(groupId, { text: result.styled });
        break;
      }

      // بدون رقم: لو مفيش نص خالص (ولا كتابة ولا رد) نعرض قايمة الخطوط بأرقامها
      let text = args.join(" ");
      if (!text) {
        text = quotedMsg?.conversation || quotedMsg?.extendedTextMessage?.text || "";
      }
      if (!text) {
        const list = decorate.STYLES.map((s, i) => `${i + 1}. ${s.name}`).join("\n");
        return sock.sendMessage(groupId, {
          text:
            `🎨 *قائمة خطوط الزخرفة (30):*\n${list}\n\n` +
            `استخدم: ${config.PREFIXES[0]}زخرفه <رقم> ردًا على رسالة، أو ${config.PREFIXES[0]}زخرفه <نص> لعرض كل الأشكال.`,
        });
      }
      const results = decorate.decorateAll(text);
      const body = results.map((r, i) => `${i + 1}. ${r.name}:\n${r.styled}`).join("\n\n");
      await sock.sendMessage(groupId, { text: `🎨 *أشكال الزخرفة (${results.length}):*\n\n${body}` });
      break;
    }

    // ---------------- نكت ----------------
    case "نكته":
    case "نكتة":
    case "joke": {
      const joke = games.getRandomJoke();
      await sock.sendMessage(groupId, { text: `😂 ${joke}` });
      break;
    }

    // ---------------- الاحصائيات (تكرار محذوف، موجود فوق) ----------------

    // ---------------- تحميل يوتيوب / تيك توك / انستجرام ----------------
    case "يوتيوب":
    case "yt": {
      const query = args.join(" ");
      if (!query) return sock.sendMessage(groupId, { text: `اكتب: ${config.PREFIXES[0]}يوتيوب <رابط الفيديو أو اسمه>` });
      await sock.sendMessage(groupId, { text: "⏳ بدور وبحمل الفيديو..." });
      downloaders.downloadYoutube(query, sock, groupId);
      break;
    }
    case "تيك":
    case "tiktok": {
      const query = args.join(" ");
      if (!query) return sock.sendMessage(groupId, { text: `اكتب: ${config.PREFIXES[0]}تيك <رابط الفيديو أو اسمه>` });
      await sock.sendMessage(groupId, { text: "⏳ بدور وبحمل الفيديو..." });
      downloaders.downloadTiktok(query, sock, groupId);
      break;
    }
    case "انستا":
    case "instagram": {
      const url = args[0];
      if (!url) return sock.sendMessage(groupId, { text: `اكتب: ${config.PREFIXES[0]}انستا <رابط البوست/الريل>` });
      await sock.sendMessage(groupId, { text: "⏳ بحمل المحتوى..." });
      downloaders.downloadInstagram(url, sock, groupId);
      break;
    }
    case "فيسبوك":
    case "fb": {
      const url = args[0];
      if (!url) return sock.sendMessage(groupId, { text: `اكتب: ${config.PREFIXES[0]}فيسبوك <رابط الفيديو>` });
      await sock.sendMessage(groupId, { text: "⏳ بحمل الفيديو..." });
      downloaders.downloadFacebook(url, sock, groupId);
      break;
    }
    case "تويتر":
    case "twitter":
    case "x": {
      const url = args[0];
      if (!url) return sock.sendMessage(groupId, { text: `اكتب: ${config.PREFIXES[0]}تويتر <رابط التغريدة>` });
      await sock.sendMessage(groupId, { text: "⏳ بحمل الفيديو..." });
      downloaders.downloadTwitter(url, sock, groupId);
      break;
    }
    case "mp3":
    case "اغنية":
    case "اغنيه": {
      const query = args.join(" ");
      if (!query) return sock.sendMessage(groupId, { text: `اكتب: ${config.PREFIXES[0]}اغنية <اسم الأغنية أو رابطها>` });
      await sock.sendMessage(groupId, { text: "⏳ بدور وبحمل الأغنية..." });
      downloaders.downloadYoutubeAudio(query, sock, groupId);
      break;
    }

    // ---------------- توليد صور بالذكاء الاصطناعي ----------------
    case "صورة":
    case "image": {
      const prompt = args.join(" ");
      if (!prompt) return sock.sendMessage(groupId, { text: `اكتب: ${config.PREFIXES[0]}صورة <وصف الصورة اللي عايزها>` });
      await sock.sendMessage(groupId, { text: "🎨 بعمل الصورة..." });
      await downloaders.generateImage(prompt, sock, groupId);
      break;
    }

    // ---------------- بحث سريع ----------------
    case "بحث":
    case "search": {
      const query = args.join(" ");
      if (!query) return sock.sendMessage(groupId, { text: `اكتب: ${config.PREFIXES[0]}بحث <كلمة أو سؤال>` });
      await downloaders.quickSearch(query, sock, groupId);
      break;
    }

    // ---------------- تفريغ رسالة صوتية (رد عليها بالأمر) ----------------
    case "تفريغ": {
      if (!quotedMsg?.audioMessage) {
        return sock.sendMessage(groupId, { text: "رد على رسالة صوتية بالأمر ده عشان أفرغها." });
      }
      await sock.sendMessage(groupId, { text: "⏳ بفرّغ الرسالة الصوتية..." });
      const audioBuffer = await ctx.downloadQuotedAudio();
      downloaders.transcribeVoice(audioBuffer, sock, groupId);
      break;
    }

    // ---------------- الحالات المحفوظة ----------------
    case "الحالات": {
      if (!senderIsOwner) return sock.sendMessage(groupId, { text: "الأمر ده لصاحب البوت بس." });
      await statusSaver.sendSavedStatuses(sock, groupId);
      break;
    }

    // ---------------- شات ذكاء اصطناعي (Groq سحابي - سريع جدًا، مجاني بالكامل) ----------------
    case "اسأل":
    case "شات":
    case "ai":
    case "gpt": {
      const prompt = args.join(" ");
      if (!prompt) {
        return sock.sendMessage(groupId, {
          text:
            `اكتب سؤالك أو طلبك بعد الأمر، مثلاً:\n${config.PREFIXES[0]}شات ايه هي عاصمة اليابان؟\n\n` +
            `الشات بيفتكر سياق كلامك انت شخصيًا (مش الجروب) على طول ما تكلمه.\n` +
            `أوامر تانية: ${config.PREFIXES[0]}اعاده_الشات، ${config.PREFIXES[0]}مسح_الشات، ` +
            `${config.PREFIXES[0]}شخصية، ${config.PREFIXES[0]}معلومات_الشات، ${config.PREFIXES[0]}حالة_الشات`,
        });
      }
      await sock.sendMessage(groupId, { text: "🤖 بفكر..." });
      await chat.askChat({ userId: numberOf(sender), prompt, sock, groupId });
      break;
    }

    // ---------------- توليد صور محليًا عن طريق نظام الشات (مجهّز لـ FLUX/Stable Diffusion) ----------------
    case "صورة_شات": {
      const prompt = args.join(" ");
      if (!prompt) {
        return sock.sendMessage(groupId, { text: `اكتب: ${config.PREFIXES[0]}صورة_شات <وصف الصورة اللي عايزها>` });
      }
      await sock.sendMessage(groupId, { text: "🎨 بعمل الصورة..." });
      await chat.generateChatImage({ userId: numberOf(sender), prompt, sock, groupId });
      break;
    }

    // ---------------- إعادة الشات بالكامل (تاريخ + شخصية + موديل يرجعوا للافتراضي) ----------------
    case "نسيان":
    case "اعاده_الشات": {
      chat.resetChat(numberOf(sender));
      await sock.sendMessage(groupId, { text: "🔄 تم إعادة تعيين الشات بالكامل (الذاكرة والشخصية والموديل)، ابدأ من جديد." });
      break;
    }

    // ---------------- مسح تاريخ المحادثة بس (الشخصية والموديل بيفضلوا زي ما هما) ----------------
    case "مسح_الشات": {
      chat.clearChat(numberOf(sender));
      await sock.sendMessage(groupId, { text: "🧠 تم مسح تاريخ المحادثة، ابدأ من جديد." });
      break;
    }

    // ---------------- عرض/تغيير شخصية الشات ----------------
    case "شخصية": {
      const requested = (args[0] || "").trim();
      const result = chat.setPersona(numberOf(sender), requested || null);
      await sock.sendMessage(groupId, { text: result.message });
      break;
    }

    // ---------------- معلومات استخدامك مع الشات ----------------
    case "معلومات_الشات": {
      const info = chat.getChatInfo(numberOf(sender));
      await sock.sendMessage(groupId, { text: info });
      break;
    }

    // ---------------- حالة الاتصال بمحرك الذكاء الاصطناعي المحلي ----------------
    case "حالة_الشات": {
      await sock.sendMessage(groupId, { text: "⏳ بفحص حالة النظام..." });
      const status = await chat.getChatStatus();
      await sock.sendMessage(groupId, { text: status });
      break;
    }

    // ---------------- المساعدة ----------------
    case "":
    case "hunter":
    case "مساعدة":
    case "الاوامر":
    case "help": {
      const p = config.PREFIXES[0];
      const prefixList = config.PREFIXES.join(" أو ");

      const lines = [
        style.bigTitle("🦈", `أوامر بوت ${config.BOT_NAME}`),
        "",
        `✨ البادئة اللي بتنادي بيها الأوامر: *${prefixList}*`,
        "",
        style.section("👮", "الإدارة"),
        style.cmd(`${p}المشرفين`, "يعرض كل مشرفين الجروب"),
        style.cmd(`${p}طرد (منشن/رد)`, "يطرد شخص من الجروب"),
        style.cmd(`${p}تحذير (منشن/رد)`, "يدي تحذير، وبعد عدد معين بيتطرد أوتوماتيك"),
        style.cmd(`${p}مسح_تحذير (منشن/رد)`, "يمسح تحذيرات شخص"),
        style.cmd(`${p}القائمة_السوداء`, "يعرض كل اللي عليهم تحذيرات"),
        style.cmd(`${p}ترقيه (منشن/رد)`, "يرقّي شخص لأدمن"),
        style.cmd(`${p}نزع (منشن/رد)`, "ينزع الأدمن عن شخص"),
        style.cmd(`${p}كتم`, "الأدمنز بس يقدروا يبعتوا في الجروب"),
        style.cmd(`${p}فك_كتم`, "يرجع الجروب لطبيعته"),
        style.cmd(`${p}قفل`, "يمنع تعديل اسم/صورة/وصف الجروب إلا للأدمنز"),
        style.cmd(`${p}فتح`, "يسمح لأي حد يعدّل معلومات الجروب"),
        style.cmd(`${p}طرد_الخاملين [عدد الأيام]`, "يطرد الأعضاء الخاملين"),
        style.cmd(`${p}موقت <ثواني>`, "عداد تنازلي، بيبعت رسالة لما يخلص"),
        style.cmd(`${p}موقت غلق <ثواني>`, "يقفل الجروب مدة معينة وبعدين يفتحه لوحده"),
        style.cmd(`${p}اسم <اسم جديد>`, "يغيّر اسم الجروب"),
        style.cmd(`${p}وصف <وصف جديد>`, "يغيّر وصف الجروب"),
        style.cmd(`${p}صورة_الجروب`, "رد بيه على صورة عشان تبقى صورة الجروب"),
        style.cmd(`${p}اضافة <رقم دولي>`, "يضيف رقم للجروب مباشرة"),
        style.cmd(`${p}حظر (منشن/رد)`, "حظر دائم - لو رجع الجروب هيتطرد أوتوماتيك"),
        style.cmd(`${p}الغاء_حظر (منشن/رد)`, "يلغي الحظر الدائم عن شخص"),
        style.cmd(`${p}المحظورين`, "يعرض قايمة المحظورين نهائيًا"),
        style.cmd(`${p}الترحيب تشغيل/تعطيل`, "يفعّل أو يعطّل رسالة الترحيب الأوتوماتيكية في الجروب ده"),
        style.cmd(`${p}الترحيب ارسال (منشن/رد)`, "يبعت رسالة الترحيب يدويًا دلوقتي لأي شخص"),
        style.cmd(`${p}حظر الروابط تشغيل/تعطيل`, "يفعّل حظر كل الروابط (مش بس روابط الدعوة) مع طرد فوري لمن يرسلها"),
        style.cmd(`${p}القوانين`, "يعرض قوانين الجروب المسجّلة"),
        style.cmd(`${p}تعيين_القوانين <نص>`, "يسجّل قوانين الجروب"),
        style.cmd(`${p}جدولة اضافه <HH:MM> <نص>`, "يضيف رسالة تتبعت أوتوماتيك كل يوم"),
        style.cmd(`${p}جدولة قايمة`, "يعرض الرسايل المجدولة"),
        style.cmd(`${p}جدولة حذف <رقم>`, "يشيل رسالة مجدولة"),
        "",
        style.section("📥", "تحميل"),
        style.cmd(`${p}يوتيوب <رابط/اسم>`, "يحمّل فيديو من يوتيوب"),
        style.cmd(`${p}mp3 <رابط/اسم>`, "يحمّل صوت بس من يوتيوب"),
        style.cmd(`${p}اغنية <اسم الأغنية>`, "يحمّل أي أغنية بالاسم"),
        style.cmd(`${p}تيك <رابط/اسم>`, "يحمّل من تيك توك (بيجيب أعلى فيديو لايكات لو اسم، وكل ما تكرر نفس الاسم بيجيب اللي بعده في الترتيب)"),
        style.cmd(`${p}انستا <رابط>`, "يحمّل بوست/ريل من انستجرام"),
        style.cmd(`${p}فيسبوك <رابط>`, "يحمّل فيديو من فيسبوك"),
        style.cmd(`${p}تويتر <رابط>`, "يحمّل فيديو من تويتر/X"),
        style.cmd(`${p}تفريغ`, "رد بيه على رسالة صوتية عشان يفرّغها كتابة"),
        style.cmd(`${p}تحويل`, "رد بيه على ملصق (استيكر) عشان يحوّله لصورة عادية"),
        "",
        style.section("🤖", "شات - ذكاء اصطناعي (Groq)"),
        style.cmd(`${p}شات <سؤالك/طلبك>`, "كلم الشات في أي حاجة: أسئلة، أكواد، شرح، ترجمة، تلخيص، رسايل..."),
        style.cmd(`${p}اعاده_الشات`, "إعادة تعيين كاملة (الذاكرة + الشخصية + الموديل للافتراضي)"),
        style.cmd(`${p}مسح_الشات`, "يمسح تاريخ المحادثة بس (الشخصية بتفضل زي ما هي)"),
        style.cmd(`${p}شخصية [اسم]`, "يعرض/يغيّر شخصية الشات (مبرمج، معلم، مترجم، رسمي، هزار...)"),
        style.cmd(`${p}معلومات_الشات`, "إحصائيات استخدامك مع الشات (الموديل، الشخصية، عدد الرسايل...)"),
        style.cmd(`${p}حالة_الشات`, "يفحص هل Groq متصل وحالة الطابور والكاش"),
        style.cmd(`${p}صورة_شات <وصف>`, "توليد صورة بالذكاء الاصطناعي"),
        style.cmd(`${p}صورة <وصف>`, "يعمل صورة بالذكاء الاصطناعي"),
        style.cmd(`${p}بحث <كلمة>`, "بحث سريع وإجابة مختصرة"),
        "",
        style.section("🗳️", "تصويت"),
        style.cmd(`${p}تصويت السؤال / خيار1 / خيار2`, "يبدأ تصويت جديد (لغاية 10 خيارات)"),
        style.cmd(`${p}صوت <رقم>`, "تصوّت في التصويت الشغال"),
        style.cmd(`${p}نتيجة_التصويت`, "يعرض نتيجة التصويت لحد دلوقتي"),
        style.cmd(`${p}انهاء_التصويت`, "ينهي التصويت ويعرض النتيجة النهائية"),
        "",
        style.section("🎮", "تفاعل وألعاب"),
        style.cmd(`${p}لعبة`, "يعرض كل الألعاب المتاحة"),
        style.cmd(`${p}حجر_ورقة_مقص <حجر/ورقة/مقص>`, "لعبة فورية"),
        style.cmd(`${p}النرد`, "يرمي نرد ويطلعلك رقم"),
        style.cmd(`${p}نسبة [كلمة] (منشن اختياري)`, "نسبة عشوائية بأي كلمة تكتبها (جمال/عبط/حظ...)، أو عشوائية لو من غير كلمة"),
        style.cmd(`${p}زخرفه`, "يعرض قائمة الـ 30 خط زخرفة بأرقامها"),
        style.cmd(`${p}زخرفه <نص>`, "يديك النص بكل الـ 30 شكل زخرفة"),
        style.cmd(`${p}زخرفه <رقم> (رد على رسالة)`, "يطبّق خط الزخرفة رقم ده بس على الرسالة"),
        style.cmd(`${p}وقف_اللعبة`, "يوقف أي لعبة شغالة"),
        style.cmd(`${p}الاحصائيات`, "أعلى 10 أعضاء تفاعلاً (ترتيب دائم محفوظ)"),
        style.cmd(`${p}الاحصائيات_كاملة`, "كل الأعضاء وعدد رسايلهم (ترتيب دائم محفوظ)"),
        style.cmd(`${p}حسبه (منشن اختياري)`, "رسايلك النهاردة/الأسبوع/الشهر"),
        style.cmd(`${p}حسبه_كليه (منشن اختياري)`, "إجمالي رسايلك وترتيبك ومتوسطك ومدة نشاطك"),
        style.cmd(`${p}نكته`, "نكتة عشوائية"),
        style.cmd(`${p}شكوى <نص>`, "يبعت شكواك لصاحب البوت"),
        "",
        style.section("👑", "صاحب البوت بس"),
        style.cmd(`${p}الحالات`, "يعرض آخر الحالات المحفوظة"),
        style.cmd(`${p}اشراف اضافه (منشن/رد)`, "يضيف حد لقايمة المسموح لهم يستخدموا الأوامر"),
        style.cmd(`${p}اشراف ازاله (منشن/رد)`, "يشيل حد من القايمة"),
        style.cmd(`${p}اشراف قايمة`, "يعرض كل المسموح لهم"),
        "",
        style.bigFooter("🌟"),
      ];

      // لو فيه صورة محفوظة في assets/bot-avatar.jpg، بنبعتها مع قايمة
      // الأوامر كاملة كـ caption للصورة نفسها (رسالة واحدة بس، مش اتنين).
      const fullText = lines.join("\n");
      if (fs.existsSync(config.BOT_AVATAR_PATH)) {
        try {
          const avatarBuffer = fs.readFileSync(config.BOT_AVATAR_PATH);
          await sock.sendMessage(groupId, {
            image: avatarBuffer,
            caption: fullText,
          });
          break;
        } catch (e) {
          console.error("مقدرتش أبعت صورة القايمة، هبعت نص بس:", e.message);
        }
      }

      await sock.sendMessage(groupId, { text: fullText });
      break;
    }
  }
}

module.exports = { handleCommand };
