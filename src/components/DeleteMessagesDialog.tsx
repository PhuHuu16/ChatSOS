import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MESSAGE_CHANGE_WINDOW_MS } from '../features/chat/api'
import type { ChatErrorKey } from '../features/chat/chatErrors'
import { recallBlock } from '../features/chat/helpers'
import type { Message } from '../features/chat/types'

interface DeleteMessagesDialogProps {
  // The selected messages, in their newest known version.
  messages: Message[]
  currentUserId: string
  // Each resolves to null on success, or the error to show.
  onHide: () => Promise<ChatErrorKey | null>
  onRecall: () => Promise<ChatErrorKey | null>
  // The dialog was closed without finishing (Cancel, ×, Escape).
  onClose: () => void
  // An action succeeded: the selection is over.
  onDone: () => void
}

// How often (ms) the recall option is checked against the time limit while open.
const TICK_MS = 5000

const OPTION_CLASS =
  'w-full rounded-lg border px-4 py-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:cursor-not-allowed disabled:opacity-60'

// Rendered only while open. The dialog itself is the confirmation: each option acts at once.
export function DeleteMessagesDialog({
  messages,
  currentUserId,
  onHide,
  onRecall,
  onClose,
  onDone,
}: DeleteMessagesDialogProps) {
  const { t } = useTranslation()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<ChatErrorKey | null>(null)
  // Blocks a second click before the pending state has re-rendered.
  const pendingRef = useRef(false)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
    const timer = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(timer)
  }, [])

  const block = recallBlock(messages, currentUserId, now, MESSAGE_CHANGE_WINDOW_MS)

  async function run(action: () => Promise<ChatErrorKey | null>) {
    if (pendingRef.current) return
    pendingRef.current = true
    setPending(true)
    setError(null)
    const result = await action().catch((): ChatErrorKey => 'chat.errors.deleteFailed')
    pendingRef.current = false
    setPending(false)
    if (result) setError(result)
    else onDone()
  }

  const headingId = 'delete-messages-heading'

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={headingId}
      onClose={onClose}
      // While a request runs, Escape must not close the dialog and hide its result.
      onCancel={(event) => {
        if (pendingRef.current) event.preventDefault()
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-xl bg-white p-0 shadow-xl backdrop:bg-slate-900/40"
    >
      <header className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
        <h2 id={headingId} className="font-semibold">
          {t('chat.deleteDialog.title', { count: messages.length })}
        </h2>
        <button
          type="button"
          onClick={() => dialogRef.current?.close()}
          disabled={pending}
          aria-label={t('chat.deleteDialog.close')}
          className="rounded-full px-2 py-1 text-xl leading-none text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:opacity-60"
        >
          <span aria-hidden="true">×</span>
        </button>
      </header>

      <div className="flex flex-col gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => void run(onHide)}
          disabled={pending}
          className={`${OPTION_CLASS} border-slate-300 hover:bg-slate-50`}
        >
          <span className="block font-medium">{t('chat.deleteDialog.hide')}</span>
          <span className="block text-sm text-slate-600">{t('chat.deleteDialog.hideNote')}</span>
        </button>

        <button
          type="button"
          onClick={() => void run(onRecall)}
          disabled={pending || block !== null}
          aria-describedby={block ? 'delete-messages-recall-block' : undefined}
          className={`${OPTION_CLASS} border-red-200 text-red-800 hover:bg-red-50`}
        >
          <span className="block font-medium">{t('chat.deleteDialog.recall')}</span>
          <span className="block text-sm text-red-700">{t('chat.deleteDialog.recallNote')}</span>
        </button>
        {block && (
          <p id="delete-messages-recall-block" className="-mt-1 text-sm text-slate-600">
            {t(`chat.deleteDialog.${block}`)}
          </p>
        )}

        <div aria-live="polite" className="text-sm">
          {pending && <p className="text-slate-600">{t('chat.deleteDialog.working')}</p>}
          {error && (
            <p role="alert" className="text-red-700">
              {t(error)}
            </p>
          )}
        </div>
      </div>

      <footer className="flex justify-end border-t border-slate-200 px-4 py-3">
        <button
          type="button"
          onClick={() => dialogRef.current?.close()}
          disabled={pending}
          className="rounded-md px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:opacity-60"
        >
          {t('chat.deleteDialog.cancel')}
        </button>
      </footer>
    </dialog>
  )
}
