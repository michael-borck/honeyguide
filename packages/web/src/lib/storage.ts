import type { BriefAnswers } from '@michaelborck/honeyguide-core/web';

export type ThemeMode = 'light' | 'dark' | 'system';

const THEME_KEY = 'honeyguide-theme';
const OUTCOMES_KEY = 'honeyguide-outcomes';
const BRIEF_KEY = 'honeyguide-brief';
const SETTINGS_KEY = 'honeyguide-settings';
// Non-secret settings live in localStorage; API keys live in sessionStorage so
// they are not persisted to disk across browser sessions (defence in depth on
// top of the CSP). The two are merged on load.
const SECRETS_KEY = 'honeyguide-secrets';

export interface Settings {
  providerUrl: string;
  apiKey: string;
  model: string;
  youtubeApiKey: string;
  /** Web-search providers. Keys stay in sessionStorage; URLs in localStorage. */
  braveApiKey: string;
  serperApiKey: string;
  searxngUrl: string;
  searchFallbackEnabled: boolean;
  searchFallbackOrder: string;
  /** Optional local System One decision model for re-ranking (ADR-0016). */
  decisionUrl: string;
  decisionModel: string;
  /** Optional local embeddings endpoint for re-ranking (ADR-0015). */
  embeddingUrl: string;
  embeddingModel: string;
  /**
   * 'auto' uses a detected local decision model (or embeddings) on a
   * localhost/desktop install; explicit modes override it.
   */
  rerankMode: 'server' | 'auto' | 'off' | 'embeddings' | 'decision';
}

export interface DetectedModels {
  url: string;
  decisionModels: string[];
  embeddingModels: string[];
}

const SECRET_KEYS = ['apiKey', 'youtubeApiKey', 'braveApiKey', 'serperApiKey'] as const;
type SecretKey = (typeof SECRET_KEYS)[number];

export const EMPTY_SETTINGS: Settings = {
  providerUrl: '',
  apiKey: '',
  model: '',
  youtubeApiKey: '',
  braveApiKey: '',
  serperApiKey: '',
  searxngUrl: '',
  searchFallbackEnabled: true,
  searchFallbackOrder: 'brave,serper,searxng',
  decisionUrl: '',
  decisionModel: 'tev1:0.8b',
  embeddingUrl: '',
  embeddingModel: 'nomic-embed-text',
  rerankMode: 'auto',
};

export const SERVER_DEFAULTS: Settings = { ...EMPTY_SETTINGS, rerankMode: 'server' };

function readJson<T>(storage: Storage, key: string): T | null {
  try {
    const raw = storage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function loadSettings(): Settings {
  const stored = readJson<Partial<Settings>>(localStorage, SETTINGS_KEY) ?? {};
  const secrets = readJson<Partial<Settings>>(sessionStorage, SECRETS_KEY) ?? {};
  return {
    ...EMPTY_SETTINGS,
    ...stored,
    ...secrets,
  };
}

export function saveSettings(settings: Settings): void {
  const secrets = Object.fromEntries(SECRET_KEYS.map((k) => [k, settings[k]]));
  const persistent = { ...settings };
  for (const key of SECRET_KEYS) delete (persistent as Record<string, unknown>)[key];
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(persistent));
    sessionStorage.setItem(SECRETS_KEY, JSON.stringify(secrets));
  } catch {
    // storage unavailable; settings still apply for this session
  }
}

export function loadTheme(): ThemeMode {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch {
    // ignore
  }
  return 'system';
}

export function saveTheme(theme: ThemeMode): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // ignore
  }
}

export function resolvedTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return mode;
}

export function loadOutcomesText(): string {
  try {
    return localStorage.getItem(OUTCOMES_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveOutcomesText(text: string): void {
  try {
    localStorage.setItem(OUTCOMES_KEY, text);
  } catch {
    // storage unavailable; outcomes still work for this session
  }
}

export function defaultBrief(): BriefAnswers {
  return {
    stance: 'support',
    priorKnowledge: 'none',
    priorNote: '',
    timing: 'pre-class',
    openAccessOnly: false,
    noVideo: false,
    recentOnly: false,
  };
}

export function loadBrief(): BriefAnswers | null {
  const data = readJson<Partial<BriefAnswers>>(localStorage, BRIEF_KEY);
  return data && typeof data === 'object' ? { ...defaultBrief(), ...data } : null;
}

export function saveBrief(brief: BriefAnswers | null): void {
  try {
    if (brief) localStorage.setItem(BRIEF_KEY, JSON.stringify(brief));
    else localStorage.removeItem(BRIEF_KEY);
  } catch {
    // storage unavailable; the brief still works for this session
  }
}