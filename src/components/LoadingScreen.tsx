import { useTranslation } from 'react-i18next'
import { BrandLogo } from './BrandLogo'

// Shown while the stored session is restored and while a redirect is pending, so a page
// that is about to be replaced is never rendered.
export function LoadingScreen() {
  const { t } = useTranslation()

  return (
    <div className="flex min-h-full flex-col bg-canvas text-fg">
      <main className="flex flex-1 flex-col items-center justify-center gap-4 px-4 pb-16">
        <BrandLogo size="lg" />
        <p role="status" className="text-sm text-muted">
          {t('auth.loading')}
        </p>
      </main>
    </div>
  )
}
