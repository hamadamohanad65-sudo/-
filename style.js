/**
 * دوال تنسيق موحّدة لرسائل البوت - عشان الرسايل تطلع شكلها حلو ومنظم
 * بدل نص عادي على طول. استخدمها بدل ما تكتب النص مباشرة.
 *
 * ملحوظة: واتساب مالوش تكبير خط حقيقي، لكن بيدعم:
 * *بولد/عريض*   _مائل_   ~مشطوب~   ```مسافة أحادية (monospace)```
 * فبنستخدم البولد للعناوين والمونوسبيس للأوامر عشان تبان مميزة وواضحة.
 */

const LINE = "┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈";
const THICK_LINE = "━━━━━━━━━━━━━━━━━━━━";

// عنوان كبير مميز (زي هيدر الرسايل الطويلة) - بولد + زخرفة عشان يبان بارز
function bigTitle(emoji, title) {
  return `╭━━━〔 ${emoji} *${title}* ${emoji} 〕━━━╮`;
}

function bigFooter(emoji) {
  return `╰━━━━━━━━━━━━${emoji ? ` ${emoji} ` : ""}━━━━━━━━━━━━╯`;
}

// صندوق بعنوان + محتوى - للرسايل الطويلة (مساعدة، قوائم، إحصائيات)
function box(title, content) {
  const body = Array.isArray(content) ? content.join("\n") : content;
  return `╭─❐ *${title}* ❐─╮\n\n${body}\n\n╰${"─".repeat(Math.min(title.length + 10, 28))}╯`;
}

// عنوان قسم داخل رسالة طويلة (زي المساعدة) - بولد وخط فاصل تحته
function section(emoji, title) {
  return `${emoji} *『 ${title} 』*\n${THICK_LINE}`;
}

// سطر أمر واحد: بيحط اسم الأمر بخط مميز (monospace) + شرح جنبه، وبعده سطر
// طويل فاصل + مسافة، عشان كل أمر يبان لوحده واضح ومنفصل عن اللي بعده
// مثال: cmd(".طرد @شخص", "يطرد شخص من الجروب") ->
// ▸ ```.طرد @شخص```
//    ↳ يطرد شخص من الجروب
// ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈
//
function cmd(usage, description) {
  const body = description
    ? `▸ \`\`\`${usage}\`\`\`\n   ↳ ${description}`
    : `▸ \`\`\`${usage}\`\`\``;
  return `${body}\n${LINE}\n`;
}

// رسالة نجاح ✅
function success(text) {
  return `✅ ${text}`;
}

// رسالة تحذير ⚠️
function warn(text) {
  return `⚠️ *تحذير*\n${LINE}\n${text}`;
}

// رسالة منع/خطر 🚫 (طرد، رفض، خطأ صلاحيات)
function danger(text) {
  return `🚫 ${text}`;
}

// رسالة معلومة عادية ℹ️
function info(text) {
  return `ℹ️ ${text}`;
}

// منشن لشخص بشكل موحّد
function mention(jid) {
  return `@${jid.split("@")[0]}`;
}

module.exports = {
  LINE,
  THICK_LINE,
  bigTitle,
  bigFooter,
  box,
  section,
  cmd,
  success,
  warn,
  danger,
  info,
  mention,
};
