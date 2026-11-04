import { useTranslation } from 'react-i18next'

interface BrandLogoProps {
  // 'lg' on the sign-in and loading screens, 'md' in headers.
  size?: 'md' | 'lg'
  // Text colour for the name, e.g. text-white on the sign-in background.
  className?: string
}

// The "C" mark and the app name. The mark is decorative: the name is the text.
export function BrandLogo({ size = 'md', className = '' }: BrandLogoProps) {
  const { t } = useTranslation()
  const large = size === 'lg'

  return (
    <span className={`inline-flex items-center ${large ? 'gap-3' : 'gap-2'} ${className}`}>
      <span
        aria-hidden="true"
        className={`flex shrink-0 items-center justify-center bg-accent font-bold text-white ${
          large ? 'size-11 rounded-xl text-xl' : 'size-7 rounded-lg text-[13px]'
        }`}
      >
        C
      </span>
      <span className={`font-semibold tracking-tight ${large ? 'text-[28px]' : 'text-[15px]'}`}>
        {t('app.name')}
      </span>
    </span>
  )
}
