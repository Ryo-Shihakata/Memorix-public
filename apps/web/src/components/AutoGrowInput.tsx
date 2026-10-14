// §12.1: [b:N] のインライン入力。下線スタイル・枠なし・幅は placeholder/入力値基準で auto-grow。
export function AutoGrowInput({
  value,
  onChange,
  onFocus,
  placeholder = '答え',
}: {
  value: string;
  onChange: (value: string) => void;
  onFocus?: () => void;
  placeholder?: string;
}) {
  const chars = Math.max(value.length, placeholder.length, 3);
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onFocus={onFocus}
      placeholder={placeholder}
      maxLength={500}
      style={{ width: `${chars + 1.5}ch` }}
      className="mx-0.5 inline-block border-0 border-b-2 border-indigo-400 bg-transparent px-0.5 text-center align-baseline focus:border-indigo-600 focus:outline-none"
    />
  );
}
