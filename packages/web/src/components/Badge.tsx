export function Badge({ text, color = '#4a6cc9' }: { text: string; color?: string }) {
  return (
    <span
      className="hg-badge"
      style={{ color, borderColor: `${color}55`, background: `${color}14` }}
    >
      {text}
    </span>
  );
}