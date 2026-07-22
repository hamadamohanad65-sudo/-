/**
 * زخرفة النصوص - 30 خط زخرفة. بياخد أي نص (عربي أو إنجليزي) ويقدر يرجّع:
 * - كل الأشكال التلاتين (لما محدش رقم معين اتطلب)
 * - أو شكل واحد بس بالرقم (زي "زخرفه 28")
 *
 * النص بتاعنا غالبًا عربي، فالأشكال دي مبنية على إطارات/رموز/حروف تراكبية
 * (combining marks) بتشتغل مع أي لغة، مش على تحويل حروف لاتينية بس
 * (زي يونيكود بولد) اللي مبيشتغلش مع العربي.
 */

// حروف تراكبية (بتتحط بعد كل حرف عادي) - بتشتغل مع أي حروف بما فيها العربي
const UNDERLINE_MARK = "\u0332";
const STRIKETHROUGH_MARK = "\u0336";
const OVERLINE_MARK = "\u0305";
const DOUBLE_UNDERLINE_MARK = "\u0333";
const DOT_ABOVE_MARK = "\u0307";
const DOT_BELOW_MARK = "\u0323";
const TILDE_ABOVE_MARK = "\u0303";
const CIRCLE_ABOVE_MARK = "\u030a";

function overlay(text, ...marks) {
  return [...text].map((ch) => ch + marks.join("")).join("");
}

function spaced(text, sep = " ") {
  return [...text].join(sep);
}

function reversed(text) {
  return [...text].reverse().join("");
}

function wrapEachChar(text, left, right) {
  return [...text].map((ch) => (ch === " " ? ch : `${left}${ch}${right}`)).join("");
}

// 30 خط زخرفة بالظبط - الترتيب هنا هو نفس الترقيم اللي بيتكتب في الأمر
// (زي "زخرفه 28" ➜ بياخد العنصر رقم 28 في المصفوفة دي)
const STYLES = [
  { name: "إطار قمري", apply: (t) => `☾ ${t} ☽` },
  { name: "إطار كتابي", apply: (t) => `『 ${t} 』` },
  { name: "نجوم", apply: (t) => `⋆⋅☆⋅⋆ ${t} ⋆⋅☆⋅⋆` },
  { name: "قلوب", apply: (t) => `𓆩♡𓆪 ${t} 𓆩♡𓆪` },
  { name: "خط مزدوج", apply: (t) => `▬▭▬▭ ${t} ▭▬▭▬` },
  { name: "ماسات", apply: (t) => `◈ ${t} ◈` },
  { name: "أقواس مزخرفة", apply: (t) => `⟦ ${t} ⟧` },
  { name: "زوايا", apply: (t) => `『❮ ${t} ❯』` },
  { name: "متباعد الحروف", apply: (t) => spaced(t) },
  { name: "بنقط بين الحروف", apply: (t) => spaced(t, "·") },
  { name: "معكوس", apply: (t) => reversed(t) },
  { name: "تحته خط", apply: (t) => overlay(t, UNDERLINE_MARK) },
  { name: "مشطوب", apply: (t) => overlay(t, STRIKETHROUGH_MARK) },
  { name: "فوقه خط", apply: (t) => overlay(t, OVERLINE_MARK) },
  { name: "صندوق", apply: (t) => `┌─────────\n│ ${t}\n└─────────` },
  { name: "خط مزدوج تحته", apply: (t) => overlay(t, DOUBLE_UNDERLINE_MARK) },
  { name: "نقطة فوق الحروف", apply: (t) => overlay(t, DOT_ABOVE_MARK) },
  { name: "نقطة تحت الحروف", apply: (t) => overlay(t, DOT_BELOW_MARK) },
  { name: "تعريج فوق الحروف", apply: (t) => overlay(t, TILDE_ABOVE_MARK) },
  { name: "دايرة فوق الحروف", apply: (t) => overlay(t, CIRCLE_ABOVE_MARK) },
  { name: "خط + شرطة", apply: (t) => overlay(t, UNDERLINE_MARK, OVERLINE_MARK) },
  { name: "ورق شجر", apply: (t) => `🍃 ${t} 🍃` },
  { name: "نار", apply: (t) => `🔥 ${t} 🔥` },
  { name: "تاج", apply: (t) => `👑 ${t} 👑` },
  { name: "نجمة مضيئة", apply: (t) => `✨ ${t} ✨` },
  { name: "سهام", apply: (t) => `➳ ${t} ➳` },
  { name: "زهور", apply: (t) => `❁ ${t} ❁` },
  { name: "أقواس نصف دايرة", apply: (t) => `༺ ${t} ༻` },
  { name: "قوسين مربعين لكل حرف", apply: (t) => wrapEachChar(t, "[", "]") },
  { name: "نجمة لكل حرف", apply: (t) => wrapEachChar(t, "⋆", "⋆") },
];

// بيرجع مصفوفة { name, styled } لكل الأشكال التلاتين
function decorateAll(text) {
  return STYLES.map((s) => ({ name: s.name, styled: s.apply(text) }));
}

// بيرجع شكل واحد بس بالرقم (1 لغاية 30). بيرجع null لو الرقم غلط.
function decorateOne(text, number) {
  const idx = Number(number) - 1;
  if (!Number.isInteger(idx) || idx < 0 || idx >= STYLES.length) return null;
  const style = STYLES[idx];
  return { name: style.name, styled: style.apply(text) };
}

module.exports = { decorateAll, decorateOne, STYLES };
