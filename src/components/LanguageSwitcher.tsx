import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES, isLanguage } from '../i18n'

const DEFAULT_CLASS_NAME =
  'h-9 rounded-lg border border-line-strong bg-surface px-2 text-sm text-fg hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

interface LanguageSwitcherProps {
  // Replaces the default look of the select (sidebar, sign-in pages).
  className?: string
  // Shows the codes (VI, EN) instead of the names, for narrow places (sidebar footer).
  short?: boolean
}

export function LanguageSwitcher({
  className = DEFAULT_CLASS_NAME,
  short = false,
}: LanguageSwitcherProps) {
  const { t, i18n } = useTranslation()
  const id = useId()
  const current = i18n.resolvedLanguage ?? DEFAULT_LANGUAGE

  return (
    <div>
      <label htmlFor={id} className="sr-only">
        {t('language.label')}
      </label>
      <select
        id={id}
        value={current}
        // With short labels, hovering shows the full name of the chosen language.
        title={short && isLanguage(current) ? t(`language.${current}`) : undefined}
        onChange={(event) => {
          const value = event.target.value
          if (isLanguage(value)) void i18n.changeLanguage(value)
        }}
        className={className}
      >
        {SUPPORTED_LANGUAGES.map((language) => (
          <option key={language} value={language}>
            {short ? language.toUpperCase() : t(`language.${language}`)}
          </option>
        ))}
      </select>
    </div>
  )
}
