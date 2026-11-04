import { useTranslation } from 'react-i18next'

interface BrandLogoProps {
  size?: 'md' | 'lg'
  className?: string
}

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
