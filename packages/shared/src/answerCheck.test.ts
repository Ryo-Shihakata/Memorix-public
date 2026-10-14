import { describe, expect, it } from 'vitest';
import { checkAnswer, normalizeAnswer } from './answerCheck';

describe('normalizeAnswer', () => {
  it('全角英数を半角化し小文字化する（大文字小文字・全角半角を吸収）', () => {
    expect(normalizeAnswer('Tokyo', { normalizeKana: false })).toBe(
      normalizeAnswer('ＴＯＫＹＯ', { normalizeKana: false }),
    );
  });

  it('normalizeKana=true のときのみカタカナをひらがなに変換する', () => {
    const kana = normalizeAnswer('トウキョウ', { normalizeKana: true });
    const hira = normalizeAnswer('とうきょう', { normalizeKana: true });
    expect(kana).toBe(hira);

    const kanaNoConvert = normalizeAnswer('トウキョウ', { normalizeKana: false });
    const hiraNoConvert = normalizeAnswer('とうきょう', { normalizeKana: false });
    expect(kanaNoConvert).not.toBe(hiraNoConvert);
  });

  it('半角カナは NFKC で全角カナに変換されるため normalizeKana の設定に関わらず一致する', () => {
    expect(normalizeAnswer('ﾄｳｷｮｳ', { normalizeKana: false })).toBe(
      normalizeAnswer('トウキョウ', { normalizeKana: false }),
    );
    expect(normalizeAnswer('ﾄｳｷｮｳ', { normalizeKana: true })).toBe(
      normalizeAnswer('トウキョウ', { normalizeKana: true }),
    );
  });

  it('前後・連続する空白を1つのスペースにトリム/圧縮する', () => {
    expect(normalizeAnswer('  tokyo   city  ', { normalizeKana: false })).toBe('tokyo city');
  });
});

describe('checkAnswer', () => {
  const opts = { normalizeKana: false };

  it('"Tokyo" と "ＴＯＫＹＯ" は一致する', () => {
    expect(checkAnswer('Tokyo', ['ＴＯＫＹＯ'], opts)).toBe(true);
  });

  it('"とうきょう" と "トウキョウ" は normalizeKana=true のときのみ一致する', () => {
    expect(checkAnswer('とうきょう', ['トウキョウ'], { normalizeKana: true })).toBe(true);
    expect(checkAnswer('とうきょう', ['トウキョウ'], { normalizeKana: false })).toBe(false);
  });

  it('"ﾄｳｷｮｳ"（半角カナ）と "トウキョウ" は常に一致する', () => {
    expect(checkAnswer('ﾄｳｷｮｳ', ['トウキョウ'], { normalizeKana: false })).toBe(true);
    expect(checkAnswer('ﾄｳｷｮｳ', ['トウキョウ'], { normalizeKana: true })).toBe(true);
  });

  it('空文字は常に不正解', () => {
    expect(checkAnswer('', ['tokyo'], opts)).toBe(false);
    expect(checkAnswer('   ', ['tokyo'], opts)).toBe(false);
    expect(checkAnswer('tokyo', [''], opts)).toBe(false);
  });

  it('前後・連続空白があっても正規化して一致判定する', () => {
    expect(checkAnswer('  tokyo  ', ['tokyo'], opts)).toBe(true);
    expect(checkAnswer('to   kyo', ['to kyo'], opts)).toBe(true);
  });

  it('複数の正解候補のいずれかに一致すればよい', () => {
    expect(checkAnswer('tokyo', ['東京', 'Tokyo', 'とうきょう'], opts)).toBe(true);
    expect(checkAnswer('osaka', ['東京', 'Tokyo', 'とうきょう'], opts)).toBe(false);
  });
});
