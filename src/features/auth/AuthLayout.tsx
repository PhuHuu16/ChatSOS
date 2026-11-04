import type { ReactNode } from 'react'
import background from '../../assets/auth-background.jpg'
import { BrandLogo } from '../../components/BrandLogo'
import { LanguageSwitcher } from '../../components/LanguageSwitcher'
import { ThemeSwitcher } from '../../components/ThemeSwitcher'
import { cornerControl } from './authStyles'

interface AuthLayoutProps {
  title: string
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}

const backgroundStyle = {
  backgroundImage: `linear-gradient(rgb(10 6 30 / 0.35), rgb(10 6 30 / 0.55)), url(${background})`,
}

export function AuthLayout({ title, children, footer, wide = false }: AuthLayoutProps) {
  return (
    <div
      style={backgroundStyle}
      className="flex min-h-full flex-col bg-[#1a0b3d] bg-cover bg-center text-zinc-100 [color-scheme:dark]"
    >
      <header className="flex items-center justify-end gap-2 px-4 py-3 sm:px-6 sm:py-5">
        <ThemeSwitcher className={cornerControl} />
        <LanguageSwitcher className={`h-9 px-2 text-sm ${cornerControl}`} />
      </header>

      <main className="flex flex-1 flex-col items-center gap-6 px-4 pt-2 pb-12 sm:justify-center sm:pt-0">
        <BrandLogo size="lg" className="text-white" />
        <div className={`w-full ${wide ? 'max-w-md' : 'max-w-sm'}`}>
          <div className="rounded-2xl border border-white/15 bg-auth-card p-6 shadow-2xl backdrop-blur-xl sm:p-7">
            <h1 className="text-center text-xl font-semibold text-white">{title}</h1>
            <div className="mt-5">{children}</div>
          </div>
          {footer && <p className="mt-5 text-center text-sm text-zinc-200">{footer}</p>}
        </div>
      </main>
    </div>
  )
}
