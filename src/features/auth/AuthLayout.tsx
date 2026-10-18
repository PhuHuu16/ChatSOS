import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { LanguageSwitcher } from '../../components/LanguageSwitcher'

interface AuthLayoutProps {
  title: string
  children: ReactNode
  // Shown under the card, e.g. the link between the login and register pages.
  footer?: ReactNode
}

export function AuthLayout({ title, children, footer }: AuthLayoutProps) {
  const { t } = useTranslation()

  return (
    <div className="flex min-h-full flex-col bg-slate-50">
      <header className="flex items-center justify-between gap-2 px-4 py-3">
        <span className="text-lg font-semibold text-brand-700">{t('app.name')}</span>
        <LanguageSwitcher />
      </header>

      <main className="flex flex-1 items-start justify-center px-4 pt-8 pb-16 sm:items-center sm:pt-0">
        <div className="w-full max-w-md">
          <div className="rounded-2xl bg-white p-6 shadow-sm">
            <h1 className="text-xl font-semibold">{title}</h1>
            <div className="mt-5">{children}</div>
          </div>
          {footer && <p className="mt-4 text-center text-sm text-slate-600">{footer}</p>}
        </div>
      </main>
    </div>
  )
}
