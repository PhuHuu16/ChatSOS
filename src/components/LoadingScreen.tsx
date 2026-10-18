import { useTranslation } from 'react-i18next'

// Shown while the stored session is restored and while a redirect is pending, so a page
// that is about to be replaced is never rendered.
export function LoadingScreen() {
  const { t } = useTranslation()

  return (
    <div className="flex min-h-full flex-col bg-slate-50">
      <header className="px-4 py-3">
        <span className="text-lg font-semibold text-brand-700">{t('app.name')}</span>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 pb-16">
        <p role="status" className="text-sm text-slate-500">
          {t('auth.loading')}
        </p>
      </main>
    </div>
  )
}
