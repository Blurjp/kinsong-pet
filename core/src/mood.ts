/**
 * Coarse emotional reading of one exchange, used to drive the avatar's face.
 * Deliberately simple and bilingual: the avatar needs a direction (smile,
 * concern, surprise…), not a nuanced emotion model. It reacts to what the
 * user said first, then to how the reply is phrased.
 */
export type Mood = "neutral" | "warm" | "happy" | "sad" | "surprised" | "thinking";

export const MOODS: readonly Mood[] = ["neutral", "warm", "happy", "sad", "surprised", "thinking"];

const SAD = /\b(sad|lonely|alone|cry|crying|cried|tears?|depressed|grief|heartbroken|hurts?|pain)\b|难过|伤心|哭了|眼泪|孤独|孤单|寂寞|难受|心痛/;
const SURPRISE = /\b(wow|whoa|what[!?]|no way|really[!?]|unbelievable|seriously[!?])\b|真的吗|不会吧|什么！|哇|天哪| OMG\b/i;
const GOOD_NEWS = /\b(good news|great news|i passed|passed my|i got (the )?(job|offer|raise)|promoted|graduated|engaged|married|birthday)\b|好消息|通过了|考上了|升职|毕业|订婚|结婚|生日快乐/;
const AFFECTION = /\b(love you|miss you|thinking of you|hugs?|kisses?)\b|爱你|想你|抱抱|亲亲/;
const REPLY_JOY = /[!！]|😄|😊|😂|🥰|😍|❤️|🎉|😀|🙂/;

export function inferMood(userText: string, replyText: string): Mood {
  const user = userText.toLowerCase();

  if (SAD.test(user)) return "sad";
  if (SURPRISE.test(userText)) return "surprised";
  if (GOOD_NEWS.test(user) || (REPLY_JOY.test(replyText) && replyText.length > 0 && countJoy(replyText) >= 2)) return "happy";
  if (AFFECTION.test(user) || AFFECTION.test(replyText)) return "warm";
  if (/[?？]\s*$|[吗呢]\s*[?？]?\s*$/.test(userText.trim())) return "thinking";
  if (countJoy(replyText) >= 2) return "happy";
  return "neutral";
}

function countJoy(text: string): number {
  const marks = text.match(/[!！]|😄|😊|😂|🥰|😍|❤️|🎉|😀|🙂/g);
  return marks ? marks.length : 0;
}
