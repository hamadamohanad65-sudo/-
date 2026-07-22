/**
 * بيقسم أي نص طويل لأجزاء بحجم مناسب لرسايل واتساب، مع محاولة القسمة عند
 * حدود منطقية (فقرة/سطر/جملة) بدل ما يقطع في نص الكلمة، وبيحافظ على
 * ```code blocks``` سليمة (يقفلها ويفتحها تاني في الجزء الجديد) عشان
 * التنسيق ميتكسرش.
 */

function splitMessage(text, maxLen) {
  if (!text) return [];
  if (text.length <= maxLen) return [text];

  const chunks = [];
  let remaining = text;

  while (remaining.length > maxLen) {
    let cutAt = -1;

    // بنحاول نقسم عند أقرب سطر فاضي (فاصل فقرات) قبل الحد الأقصى
    const paragraphBreak = remaining.lastIndexOf("\n\n", maxLen);
    if (paragraphBreak > maxLen * 0.4) {
      cutAt = paragraphBreak;
    } else {
      // أو عند نهاية سطر عادي
      const lineBreak = remaining.lastIndexOf("\n", maxLen);
      if (lineBreak > maxLen * 0.4) {
        cutAt = lineBreak;
      } else {
        // أو عند نهاية جملة (نقطة/علامة استفهام/تعجب) أو مسافة
        const sentenceBreak = Math.max(
          remaining.lastIndexOf(". ", maxLen),
          remaining.lastIndexOf("؟ ", maxLen),
          remaining.lastIndexOf("! ", maxLen),
          remaining.lastIndexOf(" ", maxLen)
        );
        cutAt = sentenceBreak > maxLen * 0.3 ? sentenceBreak + 1 : maxLen;
      }
    }

    let piece = remaining.slice(0, cutAt).trimEnd();
    remaining = remaining.slice(cutAt).trimStart();

    // لو عدد علامات ``` في الجزء ده فردي، معناها فتحنا كود بلوك ومقفلناهوش،
    // فبنقفله في آخر الجزء ده ونفتحه تاني في بداية الجزء الجاي
    const fenceCount = (piece.match(/```/g) || []).length;
    if (fenceCount % 2 !== 0) {
      piece += "\n```";
      remaining = "```\n" + remaining;
    }

    chunks.push(piece);
  }

  if (remaining.trim()) chunks.push(remaining);
  return chunks;
}

module.exports = { splitMessage };
