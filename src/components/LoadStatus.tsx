import { useTranslation } from 'react-i18next'
import type { ChatErrorKey } from '../features/chat/chatErrors'

// 'side' is for the dark sidebar; 'default' for the light chat panel.
type Tone = 'default' | 'side'

type LoadStatusProps = { tone?: Tone } & (
  | { status: 'loading' }
  | { status: 'error'; error: ChatErrorKey; onRetry: () => void }
)

const TONE_CLASSES = {
  default: {
    text: 'text-slate-500',
    error: 'text-red-700',
    button: 'border-slate-300 bg-white hover:bg-slate-50 focus-visible:outline-brand-500',
  },
  side: {
    text: 'text-side-muted',
    error: 'text-red-300',
    button:
      'border-side-line bg-side-hover text-side-fg hover:bg-side-line focus-visible:outline-side-focus',
  },
} as const

// Placeholder for a list that is loading or failed to load.
export function LoadStatus(props: LoadStatusProps) {
  const { t } = useTranslation()
  const tone = TONE_CLASSES[props.tone ?? 'default']

  if (props.status === 'loading') {
    return (
      <p role="status" className={`px-4 py-6 text-center text-sm ${tone.text}`}>
        {t('chat.loading')}
      </p>
    )
  }

  return (
    <div role="alert" className="flex flex-col items-center gap-2 px-4 py-6 text-center">
      <p className={`text-sm ${tone.error}`}>{t(props.error)}</p>
      <button
        type="button"
        onClick={props.onRetry}
        className={`rounded-md border px-3 py-1 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 ${tone.button}`}
      >
        {t('chat.retry')}
      </button>
    </div>
  )
}
