// 利用規約（雛形）。
// 注意: これは一般的なUGCサービス向けの雛形であり、正式版ではありません。
// 公開前に必ず法務担当者・弁護士のレビューを受け、サービスの実態に合わせて内容を確認・差し替えてください。
export function Terms() {
  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4 pb-12 text-sm leading-relaxed text-gray-700">
      <h1 className="text-xl font-bold text-gray-900">利用規約</h1>
      <p className="text-xs text-gray-500">最終更新日: 2026年7月19日</p>

      <p>
        この利用規約（以下「本規約」）は、Memorix（以下「本サービス」）の利用条件を定めるものです。
        利用者の皆様（以下「ユーザー」）には、本規約に従って本サービスをご利用いただきます。
      </p>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-gray-900">第1条（適用）</h2>
        <p>
          本規約は、ユーザーと本サービス運営者との間の本サービスの利用に関わる一切の関係に適用されます。
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-gray-900">第2条（禁止事項）</h2>
        <p>ユーザーは、本サービスの利用にあたり、以下の行為をしてはなりません。</p>
        <ul className="list-inside list-disc space-y-1">
          <li>法令または公序良俗に違反する行為</li>
          <li>犯罪行為に関連する行為</li>
          <li>
            他のユーザーまたは第三者の知的財産権、肖像権、プライバシー、名誉その他の権利・利益を侵害する行為
          </li>
          <li>本サービスのコンテンツ（クイズ等）を無断で複製・転載・転用する行為</li>
          <li>スパム行為、その他本サービスの運営を妨害する行為</li>
          <li>不正アクセス、または不正アクセスを試みる行為</li>
          <li>その他、運営者が不適切と判断する行為</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-gray-900">第3条（ユーザー投稿コンテンツ）</h2>
        <p>
          ユーザーが本サービス上に投稿・作成したクイズ等のコンテンツ（以下「投稿コンテンツ」）の著作権は、
          当該ユーザーに帰属します。ただし、ユーザーは運営者に対し、本サービスの提供・改善・宣伝に必要な範囲で
          投稿コンテンツを利用（複製、公開、表示等）する権利を許諾するものとします。
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-gray-900">第4条（通報・モデレーション対応）</h2>
        <p>
          運営者は、ユーザーから通報を受けた投稿コンテンツについて内容を確認し、本規約に違反すると判断した場合、
          事前の通知なく当該コンテンツの非公開化・削除、投稿者アカウントの利用停止その他必要な措置を講じることができます。
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-gray-900">第5条（免責事項）</h2>
        <p>
          運営者は、本サービスに事実上または法律上の瑕疵（安全性、信頼性、正確性、完全性、有効性、
          特定の目的への適合性等に関する瑕疵を含みます）がないことを明示的にも黙示的にも保証しておりません。
          本サービスに起因してユーザーに生じた損害について、運営者の故意または重過失による場合を除き、
          運営者は一切の責任を負わないものとします。
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-gray-900">第6条（規約の変更）</h2>
        <p>
          運営者は、必要と判断した場合には、ユーザーへの事前の通知なく本規約を変更することができるものとします。
        </p>
      </section>

      <p className="text-xs text-gray-500">
        ※本ページは雛形であり正式版ではありません。公開前に内容の確認・差し替えを行ってください。
      </p>
    </div>
  );
}
