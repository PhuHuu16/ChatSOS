import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ChatErrorKey } from '../features/chat/chatErrors'
import { CLOSE_BUTTON, DANGER_BUTTON, DIALOG, DIALOG_FOOTER, DIALOG_HEADER, GHOST_BUTTON } from './dialogStyles'
import { ICON_PROPS } from './iconProps'

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
      className={DIALOG}
    >
      <header className={`${DIALOG_HEADER} items-start`}>
        <h2 id={headingId} className="min-w-0 pt-1.5 text-base font-semibold wrap-break-word">
          {t('chat.deleteConversationDialog.title', { name: title })}
        </h2>
        <button
          type="button"
          onClick={() => dialogRef.current?.close()}
          disabled={pending}
          aria-label={t('chat.deleteConversationDialog.close')}
          className={CLOSE_BUTTON}
        >
          <svg {...ICON_PROPS} strokeWidth={2}>
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </header>

      <div className="flex flex-col gap-2 px-5 py-4 text-sm">
        <p className="text-fg">{t('chat.deleteConversationDialog.body')}</p>
        <div aria-live="polite">
          {pending && <p className="text-muted">{t('chat.deleteConversationDialog.deleting')}</p>}
          {error && (
            <p role="alert" className="text-danger">
              {t(error)}
            </p>
          )}
        </div>
      </div>

      <footer className={`${DIALOG_FOOTER} justify-end`}>
        <button
          ref={cancelRef}
          type="button"
          onClick={() => dialogRef.current?.close()}
          disabled={pending}
          className={GHOST_BUTTON}
        >
          {t('chat.deleteConversationDialog.cancel')}
        </button>
        <button
          type="button"
          onClick={() => void confirm()}
          disabled={pending}
          className={DANGER_BUTTON}
        >
          {t('chat.deleteConversationDialog.confirm')}
        </button>
      </footer>
    </dialog>
  )
}
