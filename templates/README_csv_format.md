# Memorix CSV インポート/エクスポート形式

クイズをまとめて作成・編集したいときは、この3つの CSV ファイルを編集して
Studio の「CSVインポート」からアップロードしてください。

- `text_questions.csv` — 穴埋めテキスト問題
- `table_questions.csv` — 表形式の問題
- `blanks.csv` — すべての問題に共通の「空欄の正解」設定

3ファイルとも UTF-8（BOM付き可）。Excel で編集した CSV もそのまま使えます。
インポートは「プレビュー」で内容と警告を確認してから「確定」してください。
プレビューでは DB への書き込みは行われません。

## 共通ルール

- `question_id` はクイズ内で一意な自分で決めるID（英数字推奨。例: `q-001`）。
  これは既存の問題を**上書き更新**するためのキーとして使われます
  （再インポート時に同じ `question_id` があれば、その問題を削除して同じ内容で作り直します）。
- `image_url` は Memorix にアップロード済みの画像の URL（`/img/{画像ID}` 形式）のみ有効です。
  それ以外の値（外部URLなど）は警告のうえ無視されます。あらかじめ Studio の
  画像ライブラリにアップロードしてから URL をコピーしてください。
- 空欄の正解は、この3ファイルとは別に `blanks.csv` にまとめて書きます。

## text_questions.csv（穴埋めテキスト問題）

| 列 | 必須 | 説明 |
|---|---|---|
| question_id | ○ | 問題の識別子（クイズ内で一意） |
| display_order | ○ | 表示順（0始まりの整数） |
| question_title | - | 問題タイトル（省略可） |
| text_content | ○ | 本文。空欄には `[b:1]`, `[b:2]` ... のマーカーを埋め込む |
| image_url | - | 問題に添付する画像（`/img/{id}` 形式） |

本文中の `[b:N]` マーカーの集合は、`blanks.csv` でその `question_id` に
定義した `blank_order` の集合と**完全に一致**していなければなりません
（過不足があるとインポート確定時にエラーになります）。

例:

```
question_id,display_order,question_title,text_content,image_url
q-001,0,首都,日本の首都は[b:1]です。,
```

## table_questions.csv（表形式問題）

1行 = 表の1セルです。同じ `question_id` の行を複数並べて1つの表を表現します。

| 列 | 必須 | 説明 |
|---|---|---|
| question_id | ○ | 問題の識別子（クイズ内で一意） |
| display_order | ○ | 表示順（同じ問題の行はすべて同じ値にする） |
| question_title | - | 問題タイトル（同上） |
| image_url | - | 問題に添付する画像（同上、表全体に対する画像） |
| row | ○ | 行番号（0始まり、最大19） |
| col | ○ | 列番号（0始まり、最大9） |
| cell_type | ○ | `text` / `header` / `blank` / `image` のいずれか |
| content | - | セルの表示内容（`text`/`header` セルで使用） |
| is_blank | `cell_type=blank` のとき必須 | 対応する空欄番号（`blanks.csv` の `blank_order`） |

`cell_type=blank` のセル数・空欄番号は、`blanks.csv` の同じ `question_id` の
行と完全に一致していなければなりません。

`cell_type=image` のセルの画像は、CSV では指定できません（Studio の
エディタ画面から個別に設定してください）。

## blanks.csv（空欄の正解設定）

`text_questions.csv` / `table_questions.csv` の両方に対して、すべての空欄を
この1ファイルにまとめて書きます。

| 列 | 必須 | 説明 |
|---|---|---|
| question_id | ○ | 対応する問題の識別子 |
| blank_order | ○ | 空欄番号（`[b:N]` の N、または `is_blank` の値） |
| accepted_answers | ○ | 正解候補。複数ある場合は `\|`（パイプ）区切り |
| hint | - | ヒント文（省略可） |

例:

```
question_id,blank_order,accepted_answers,hint
q-001,1,東京|とうきょう|Tokyo,日本の首都
```

## エクスポートについて

Studio からエクスポートすると、上記3ファイルを zip にまとめてダウンロード
できます。エクスポートした CSV は、そのまま別のクイズへの再インポートにも
使えます。

セルの先頭が `=` `+` `-` `@` で始まる場合、表計算ソフトで数式として実行され
てしまう事故（CSVインジェクション）を防ぐため、先頭に `'`（シングルクォート）
を自動的に付けてエクスポートします。
