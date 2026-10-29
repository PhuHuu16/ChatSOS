import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ChatErrorKey } from '../features/chat/chatErrors'

interface DeleteConversationDialogProps {
  // The conversation's name as the list shows it.
  title: string
  // Resolves to null on success, or the error to show.
  onConfirm: () => Promise<ChatErrorKey | null>
  // Closed without deleting (Cancel, ×, Escape).
  onClose: () => void
  // The conversation was deleted.
  onDone: () => void
}

// Rendered only while open. Asks once more before deleting a conversation's history for
// the user (other members keep it).
export function DeleteConversationDialog({
  title,
  onConfirm,
  onClose,
  onDone,
}: DeleteConversationDialogProps) {
  const { t } = useTranslation()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<ChatErrorKey | null>(null)
  // Blocks a second click before the pending state has re-rendered.
  const pendingRef = useRef(false)

  // Focus starts on Cancel, so Enter right after opening does not delete anything.
  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
    cancelRef.current?.focus()
  }, [])

  async function confirm() {
    if (pendingRef.current) return
    pendingRef.current = true
    setPending(true)
    setError(null)
    const result = await onConfirm().catch(
      (): ChatErrorKey => 'chat.errors.deleteConversationFailed',
    )
    pendingRef.current = false
    setPending(false)
    if (result) setError(result)
    else onDone()
  }

  const headingId = 'delete-conversation-heading'

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={headingId}
      onClose={onClose}
      // While the request runs, Escape must not close the dialog and hide its result.
      onCancel={(event) => {
        if (pendingRef.current) event.preventDefault()
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-xl bg-white p-0 shadow-xl backdrop:bg-slate-900/40"
    >
      <header className="flex items-start justify-between gap-2 border-b border-slate-200 px-4 py-3">
        <h2 id={headingId} className="min-w-0 font-semibold wrap-break-word">
          {t('chat.deleteConversationDialog.title', { name: title })}
        </h2>
        <button
          type="button"
          onClick={() => dialogRef.current?.close()}
          disabled={pending}
          aria-label={t('chat.deleteConversationDialog.close')}
          className="rounded-full px-2 py-1 text-xl leading-none text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:opacity-60"
        >
          <span aria-hidden="true">×</span>
        </button>
      </header>

      <div className="flex flex-col gap-2 px-4 py-3 text-sm">
        <p className="text-slate-700">{t('chat.deleteConversationDialog.body')}</p>
        <div aria-live="polite">
          {pending && <p className="text-slate-600">{t('chat.deleteConversationDialog.deleting')}</p>}
          {error && (
            <p role="alert" className="text-red-700">
              {t(error)}
            </p>
          )}
        </div>
      </div>

      <footer className="flex justify-end gap-2 border-t border-slate-200 px-4 py-3">
        <button
          ref={cancelRef}
          type="button"
          onClick={() => dialogRef.current?.close()}
          disabled={pending}
          className="rounded-md px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:opacity-60"
        >
          {t('chat.deleteConversationDialog.cancel')}
        </button>
        <button
          type="button"
          onClick={() => void confirm()}
          disabled={pending}
          className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {t('chat.deleteConversationDialog.confirm')}
        </button>
      </footer>
    </dialog>
  )
}
