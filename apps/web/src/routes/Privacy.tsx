// プライバシーポリシー（雛形）。
// 注意: これは一般的なUGCサービス向けの雛形であり、正式版ではありません。
// 公開前に必ず法務担当者・弁護士のレビューを受け、サービスの実態に合わせて内容を確認・差し替えてください。
export function Privacy() {
  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4 pb-12 text-sm leading-relaxed text-gray-700">
      <h1 className="text-xl font-bold text-gray-900">プライバシーポリシー</h1>
      <p className="text-xs text-gray-500">最終更新日: 2026年7月19日</p>

      <p>Memorix（以下「本サービス」）は、ユーザーの個人情報を以下の方針に基づき取り扱います。</p>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-gray-900">第1条（取得する情報）</h2>
        <p>本サービスは、Google または Microsoft のOAuth認証を通じて、以下の情報を取得します。</p>
        <ul className="list-inside list-disc space-y-1">
          <li>メールアドレス</li>
          <li>氏名（表示名）</li>
          <li>プロフィール画像（アバター）のURL</li>
        </ul>
        <p>
          また、本サービスの利用にあたり、クイズの受験履歴・回答内容、アクセス時のIPアドレス・User-Agent等の
          技術的情報を取得することがあります。
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-gray-900">第2条（Cookie・セッションの利用）</h2>
        <p>
          本サービスは、ログイン状態を維持するためにセッションCookieを利用します。このCookieは本サービスの
          機能提供に必要な範囲でのみ使用し、第三者への広告配信等の目的では使用しません。
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-gray-900">第3条（利用目的）</h2>
        <p>取得した情報は、以下の目的で利用します。</p>
        <ul className="list-inside list-disc space-y-1">
          <li>本サービスの提供・維持・改善のため</li>
          <li>ユーザー認証、不正利用の防止のため</li>
          <li>通報・モデレーション対応のため</li>
          <li>利用状況の分析（DAU等の統計）のため</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-gray-900">第4条（第三者提供）</h2>
        <p>
          本サービスは、法令に基づく場合を除き、ユーザーの同意なく個人情報を第三者に提供することはありません。
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-gray-900">第5条（お問い合わせ）</h2>
        <p>個人情報の取り扱いに関するお問い合わせは、本サービスの運営者までご連絡ください。</p>
      </section>

      <p className="text-xs text-gray-500">
        ※本ページは雛形であり正式版ではありません。公開前に内容の確認・差し替えを行ってください。
      </p>
    </div>
  );
}
