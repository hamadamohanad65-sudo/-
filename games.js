/**
 * كل ألعاب البوت (7 ألعاب): تخمين رقم، تخمين كلمة، حساب، صح/غلط،
 * سؤال ثقافة عامة، ترتيب حروف، وحجر/ورقة/مقص + نرد + نكت (فورية، مالهاش حالة).
 *
 * activeGames[groupId] بتاخد شكل: { type, ...بيانات خاصة باللعبة }
 */
const config = require("./config");
const { activeGames } = require("./storage");

// ---------------- بيانات الألعاب ----------------
const WORDS = [
  "قمر", "شمس", "بحر", "جبل", "نجمة", "وردة", "كتاب", "مدرسة",
  "حاسوب", "تفاحة", "سيارة", "طائرة", "حديقة", "مفتاح", "ساعة",
];

const TRUE_FALSE = [
  { statement: "الشمس أكبر من الأرض", answer: true },
  { statement: "القطة حيوان لاحم", answer: true },
  { statement: "برج إيفل موجود في لندن", answer: false },
  { statement: "الماء يغلي عند 100 درجة مئوية على مستوى سطح البحر", answer: true },
  { statement: "القمر كوكب", answer: false },
  { statement: "مصر فيها أهرامات الجيزة", answer: true },
  { statement: "الفيل أصغر من النملة", answer: false },
];

const TRIVIA = [
  { q: "عاصمة مصر؟", options: ["القاهرة", "الإسكندرية", "أسوان", "الأقصر"], correctIndex: 1 },
  { q: "كام قارة في العالم؟", options: ["5", "6", "7", "8"], correctIndex: 3 },
  { q: "أكبر محيط في العالم؟", options: ["الأطلسي", "الهادي", "الهندي", "المتجمد"], correctIndex: 2 },
  { q: "لغة البرمجة اللي اسمها على اسم ثعبان؟", options: ["Java", "Python", "Ruby", "Go"], correctIndex: 2 },
  { q: "كام لاعب في فريق كرة القدم؟", options: ["9", "10", "11", "12"], correctIndex: 3 },
];

const JOKES = [
  "واحد سأل صاحبه: ليه بتاخد المكنسة معاك في النوم؟ قاله: عشان لو حلمت إني بكنس مش أصحى تعبان 😂",
  "واحد قال لصاحبه: عارف ليه القطط بتنام كتير؟ قاله: عشان بتخاف تفوت حاجة وهي صاحية 😹",
  "الفرق بين الديزل والبنزين... إن واحد بيشتغل بالسولار والتاني بيشتغل بالبنزين، خلاص كده 😅",
  "واحد فاشل في الرياضة، لما سألوه بتتمرن ازاي؟ قال: بارفع التليفون كل ما حد يكلمني 🏋️",
  "ليه السمكة ما بتحبش تلعب تنس؟ عشان خايفة من الشبكة 🎾🐟",
];

function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function shuffleWord(word) {
  const letters = word.split("");
  for (let i = letters.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [letters[i], letters[j]] = [letters[j], letters[i]];
  }
  const shuffled = letters.join("");
  // لو الخلط طلع نفس الكلمة بالظبط، جرب تاني
  return shuffled === word ? shuffleWord(word) : shuffled;
}

// ================= بدء الألعاب =================
function startNumberGame(groupId) {
  const target = Math.floor(Math.random() * config.GAME_MAX_NUMBER) + 1;
  activeGames[groupId] = { type: "number", target, tries: 0 };
  return target;
}

function startWordGame(groupId) {
  const word = randomFrom(WORDS);
  activeGames[groupId] = { type: "word", word };
  return word;
}

function startMathGame(groupId) {
  const a = Math.floor(Math.random() * 20) + 1;
  const b = Math.floor(Math.random() * 20) + 1;
  const ops = ["+", "-", "×"];
  const op = randomFrom(ops);
  let answer;
  if (op === "+") answer = a + b;
  else if (op === "-") answer = a - b;
  else answer = a * b;
  activeGames[groupId] = { type: "math", answer };
  return `${a} ${op} ${b}`;
}

function startTrueFalseGame(groupId) {
  const item = randomFrom(TRUE_FALSE);
  activeGames[groupId] = { type: "truefalse", answer: item.answer };
  return item.statement;
}

function startTriviaGame(groupId) {
  const item = randomFrom(TRIVIA);
  activeGames[groupId] = { type: "trivia", correctIndex: item.correctIndex };
  return item;
}

function startUnscrambleGame(groupId) {
  const word = randomFrom(WORDS);
  const shuffled = shuffleWord(word);
  activeGames[groupId] = { type: "unscramble", word };
  return shuffled;
}

// ================= حالة اللعبة =================
function isGameActive(groupId) {
  return !!activeGames[groupId];
}

function stopGame(groupId) {
  delete activeGames[groupId];
}

// ================= معالجة إجابة (أي لعبة شغالة) =================
// بترجع outcome object لـ index.js عشان يبعت الرد المناسب، أو null لو
// الرسالة مش إجابة بالشكل المتوقع (تتجاهل تمامًا وتكمل معالجة عادية)
function handleAnswer(groupId, text) {
  const game = activeGames[groupId];
  if (!game) return null;
  const trimmed = (text || "").trim();
  if (!trimmed) return null;

  switch (game.type) {
    case "number": {
      const guess = parseInt(trimmed, 10);
      if (isNaN(guess)) return null;
      game.tries++;
      if (guess === game.target) {
        const tries = game.tries;
        delete activeGames[groupId];
        return { type: "number", result: "correct", tries };
      }
      return { type: "number", result: guess > game.target ? "high" : "low" };
    }

    case "word": {
      if (trimmed === game.word) {
        delete activeGames[groupId];
        return { type: "word", result: "correct" };
      }
      return null; // تخمين غلط - تفضل اللعبة شغالة، من غير رد
    }

    case "math": {
      if (!/^-?\d+$/.test(trimmed)) return null;
      const num = parseInt(trimmed, 10);
      if (num === game.answer) {
        delete activeGames[groupId];
        return { type: "math", result: "correct" };
      }
      return null;
    }

    case "truefalse": {
      let guessBool;
      if (trimmed === "صح") guessBool = true;
      else if (trimmed === "غلط") guessBool = false;
      else return null;
      delete activeGames[groupId];
      return {
        type: "truefalse",
        result: guessBool === game.answer ? "correct" : "wrong",
        correctAnswer: game.answer,
      };
    }

    case "trivia": {
      if (!/^\d+$/.test(trimmed)) return null;
      const idx = parseInt(trimmed, 10) - 1; // المستخدم بيكتب 1، 2، 3... مش index من صفر
      delete activeGames[groupId];
      return {
        type: "trivia",
        result: idx === game.correctIndex ? "correct" : "wrong",
        correctAnswer: game.correctIndex + 1,
      };
    }

    case "unscramble": {
      if (trimmed === game.word) {
        delete activeGames[groupId];
        return { type: "unscramble", result: "correct" };
      }
      return null;
    }

    default:
      return null;
  }
}

// ================= ألعاب فورية (من غير حالة محفوظة) =================
function playRockPaperScissors(choiceRaw) {
  const map = {
    "حجر": "حجر", "rock": "حجر",
    "ورقة": "ورقة", "ورق": "ورقة", "paper": "ورقة",
    "مقص": "مقص", "scissors": "مقص",
  };
  const choice = map[(choiceRaw || "").trim().toLowerCase()];
  if (!choice) return null;

  const options = ["حجر", "ورقة", "مقص"];
  const botChoice = randomFrom(options);

  if (choice === botChoice) return { result: "draw", botChoice };

  const beats = { "حجر": "مقص", "ورقة": "حجر", "مقص": "ورقة" };
  const userWins = beats[choice] === botChoice;
  return { result: userWins ? "win" : "lose", botChoice };
}

function rollDice() {
  return Math.floor(Math.random() * 6) + 1;
}

function getRandomJoke() {
  return randomFrom(JOKES);
}

// ================= نسب هزار عشوائية (من غير أي ربط بعرق/لون/دين) =================
const FUN_PERCENT_LABELS = [
  "نسبة الجنان", "نسبة الكسل", "نسبة الحظ", "نسبة الرومانسية",
  "نسبة الجدعنة", "نسبة النوم", "نسبة الشقاوة", "نسبة الطيبة",
];

function getFunPercentage(labelIndex) {
  const label = FUN_PERCENT_LABELS[labelIndex] || randomFrom(FUN_PERCENT_LABELS);
  const percent = Math.floor(Math.random() * 101);
  return { label, percent };
}

// نسبة عشوائية برقم بس (من غير تسمية) - تستخدم لما المستخدم يكتب تسميته
// الخاصة بعد أمر "نسبة" زي: .نسبة جمال @شخص
function randomPercent() {
  return Math.floor(Math.random() * 101);
}

module.exports = {
  startNumberGame,
  startWordGame,
  startMathGame,
  startTrueFalseGame,
  startTriviaGame,
  startUnscrambleGame,
  isGameActive,
  stopGame,
  handleAnswer,
  playRockPaperScissors,
  rollDice,
  getRandomJoke,
  FUN_PERCENT_LABELS,
  getFunPercentage,
  randomPercent,
};
