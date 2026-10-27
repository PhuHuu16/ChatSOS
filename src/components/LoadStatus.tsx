import { useTranslation } from 'react-i18next'
import type { ChatErrorKey } from '../features/chat/chatErrors'

type LoadStatusProps =
  | { status: 'loading' }
  | { status: 'error'; error: ChatErrorKey; onRetry: () => void }

// Placeholder for a list that is loading or failed to load.
export function LoadStatus(props: LoadStatusProps) {
  const { t } = useTranslation()

  if (props.status === 'loading') {
    return (
      <p role="status" className="px-4 py-6 text-center text-sm text-slate-500">
        {t('chat.loading')}
      </p>
    )
  }

  return (
    <div role="alert" className="flex flex-col items-center gap-2 px-4 py-6 text-center">
      <p className="text-sm text-red-700">{t(props.error)}</p>
      <button
        type="button"
        onClick={props.onRetry}
        className="rounded-md border border-slate-300 bg-white px-3 py-1 text-sm hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
      >
        {t('chat.retry')}
      </button>
    </div>
  )
}
