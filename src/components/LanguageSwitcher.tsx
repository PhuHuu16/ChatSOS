import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES, isLanguage } from '../i18n'

const DEFAULT_CLASS_NAME =
  'rounded-md border border-slate-300 bg-white px-2 py-1 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500'

interface LanguageSwitcherProps {
  // Replaces the default look of the select (sidebar, sign-in pages).
  className?: string
}

export function LanguageSwitcher({ className = DEFAULT_CLASS_NAME }: LanguageSwitcherProps) {
  const { t, i18n } = useTranslation()
  const id = useId()

  return (
    <div>
      <label htmlFor={id} className="sr-only">
        {t('language.label')}
      </label>
      <select
        id={id}
        value={i18n.resolvedLanguage ?? DEFAULT_LANGUAGE}
        onChange={(event) => {
          const value = event.target.value
          if (isLanguage(value)) void i18n.changeLanguage(value)
        }}
        className={className}
      >
        {SUPPORTED_LANGUAGES.map((language) => (
          <option key={language} value={language}>
            {t(`language.${language}`)}
          </option>
        ))}
      </select>
    </div>
  )
}
