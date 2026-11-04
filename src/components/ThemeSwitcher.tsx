import { useTranslation } from 'react-i18next'
import {
  nextThemePreference,
  setThemePreference,
  useThemePreference,
  type ThemePreference,
} from '../lib/theme'

interface ThemeSwitcherProps {
  className?: string
}

// Đổi giao diện sáng/tối
export function ThemeSwitcher({ className = 'focus-visible:outline-accent' }: ThemeSwitcherProps) {
  const { t } = useTranslation()
  const preference = useThemePreference()
  const label = t('theme.button', { value: t(`theme.${preference}`) })

  return (
    <button
      type="button"
      onClick={() => setThemePreference(nextThemePreference(preference))}
      aria-label={label}
      title={label}
      className={`inline-flex size-9 shrink-0 items-center justify-center rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 ${className}`}
    >
      <ThemeIcon preference={preference} />
    </button>
  )
}

function ThemeIcon({ preference }: { preference: ThemePreference }) {
  const common = {
    'aria-hidden': true,
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  } as const

  if (preference === 'light') {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    )
  }
  if (preference === 'dark') {
    return (
      <svg {...common}>
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
      </svg>
    )
  }
  return (
    <svg {...common}>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </svg>
  )
}
