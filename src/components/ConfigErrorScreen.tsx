import { useTranslation } from 'react-i18next'
import { BrandLogo } from './BrandLogo'
import { LanguageSwitcher } from './LanguageSwitcher'
import { ThemeSwitcher } from './ThemeSwitcher'

interface ConfigErrorScreenProps {
  // 'config': the Supabase settings are missing or invalid.
  // 'load': the application code could not be loaded.
  // 'crash': the app hit an unexpected error while running.
  reason: 'config' | 'load' | 'crash'
}

// Rendered before the app is loaded, so it must never import Supabase code. It receives
// no configuration values and shows only fixed, translated text.
export function ConfigErrorScreen({ reason }: ConfigErrorScreenProps) {
  const { t } = useTranslation()
  const canReload = reason !== 'config'
  const title = {
    config: t('config.title'),
    load: t('config.loadFailedTitle'),
    crash: t('config.crashTitle'),
  }[reason]
  const description = {
    config: t('config.description'),
    load: t('config.loadFailedDescription'),
    crash: t('config.crashDescription'),
  }[reason]

  return (
    <div className="flex min-h-full flex-col bg-subtle text-fg">
      <header className="flex items-center justify-between gap-2 px-4 py-3">
        <BrandLogo />
        <div className="flex items-center gap-1">
          <ThemeSwitcher className="text-muted hover:bg-hover hover:text-fg focus-visible:outline-accent" />
          <LanguageSwitcher />
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 pb-16">
        <div
          role="alert"
          className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 text-center shadow-sm"
        >
          <h1 className="text-lg font-semibold">{title}</h1>
          <p className="mt-2 text-sm text-muted">{description}</p>
          {canReload && (
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-5 inline-flex h-9 items-center rounded-lg bg-accent px-5 text-sm font-semibold text-white hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              {t('config.reload')}
            </button>
          )}
        </div>
      </main>
    </div>
  )
}
