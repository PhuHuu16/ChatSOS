import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { en } from './locales/en'
import { vi } from './locales/vi'

export const SUPPORTED_LANGUAGES = ['vi', 'en'] as const
export type Language = (typeof SUPPORTED_LANGUAGES)[number]
export const DEFAULT_LANGUAGE: Language = 'vi'

const STORAGE_KEY = 'chatsos.language'

export function isLanguage(value: unknown): value is Language {
  return SUPPORTED_LANGUAGES.some((language) => language === value)
}

// localStorage can be missing or throw (private mode, blocked site data, non-browser runtime).
function readStoredLanguage(): Language | null {
  try {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY)
    return isLanguage(stored) ? stored : null
  } catch {
    return null
  }
}

function syncLanguage(language: string) {
  if (!isLanguage(language)) return
  if (typeof document !== 'undefined') {
    document.documentElement.lang = language
  }
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, language)
  } catch {
    // The choice just won't persist across reloads.
  }
}

i18n.on('languageChanged', syncLanguage)

void i18n.use(initReactI18next).init({
  resources: {
    vi: { translation: vi },
    en: { translation: en },
  },
  lng: readStoredLanguage() ?? DEFAULT_LANGUAGE,
  fallbackLng: DEFAULT_LANGUAGE,
  supportedLngs: SUPPORTED_LANGUAGES,
  // Translations are bundled, so initialise synchronously: no flash of raw keys.
  initAsync: false,
  // React already escapes rendered text. Never pass t() output to dangerouslySetInnerHTML.
  interpolation: { escapeValue: false },
})

export default i18n
