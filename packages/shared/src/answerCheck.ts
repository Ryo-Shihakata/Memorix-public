export interface NormalizationOptions {
  normalizeKana: boolean;
}

export function normalizeAnswer(str: string, opts: NormalizationOptions): string {
  // NFKC: 全角英数/記号→半角、半角ｶﾅ→全角カナ、㍑等の互換文字も吸収
  let s = str.normalize('NFKC').trim().toLowerCase();
  s = s.replace(/\s+/g, ' '); // 連続空白を1つに
  if (opts.normalizeKana) {
    s = s.replace(
      /[ァ-ヶ]/g,
      (c) => String.fromCharCode(c.charCodeAt(0) - 0x60), // カタカナ→ひらがな
    );
  }
  return s;
}

export function checkAnswer(
  userAnswer: string,
  acceptedAnswers: string[],
  opts: NormalizationOptions,
): boolean {
  const n = normalizeAnswer(userAnswer, opts);
  if (n === '') return false;
  return acceptedAnswers.some((a) => normalizeAnswer(a, opts) === n);
}
