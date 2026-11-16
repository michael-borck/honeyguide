import type { ThemeMode } from '../lib/storage';

export function Header({
  theme,
  onCycleTheme,
  onToggleSettings,
  settingsOpen,
  onOpenInterview,
}: {
  theme: ThemeMode;
  onCycleTheme: () => void;
  onToggleSettings: () => void;
  settingsOpen: boolean;
  onOpenInterview: () => void;
}) {
  return (
    <>
      <header className="hg-header">
        <h1 className="hg-brand">🪶 Honeyguide</h1>
        <div className="hg-header-actions">
          <button
            onClick={onCycleTheme}
            className="hg-btn hg-btn-ghost hg-btn-small"
            title={`Theme: ${theme}`}
            aria-label={`Theme: ${theme}. Click to change.`}
          >
            {theme === 'dark' ? '🌙' : theme === 'light' ? '☀️' : '🖥'}
            <span className="hg-theme-label">{theme}</span>
          </button>
          <button
            onClick={onOpenInterview}
            className="hg-btn hg-btn-ghost hg-btn-small"
            title="Four-question interview brief"
          >
            🎤 Brief
          </button>
          <button
            onClick={onToggleSettings}
            className="hg-btn hg-btn-ghost hg-btn-small"
            aria-expanded={settingsOpen}
          >
            ⚙ Settings
          </button>
        </div>
      </header>
      <p className="hg-tagline">
        Verified supporting resources for your teaching — every link checked, nothing generated.
      </p>
    </>
  );
}