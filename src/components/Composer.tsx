import {
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import { useTranslation } from 'react-i18next'
import { checkTextMessage, MESSAGE_MAX_LENGTH } from '../features/chat/api'
import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_MAX_MB,
  checkAttachmentFile,
  type CheckedFile,
  type FileCheckErrorKey,
} from '../features/chat/attachments'

// The text box grows with its content up to this height (px), then scrolls.
const MAX_TEXTAREA_HEIGHT = 160

// An existing message being edited in the box instead of a new one being written.
export interface ComposerEditing {
  // The text the box starts with.
  content: string
  // Waiting for the server to save the edit.
  saving: boolean
  // Receives the checked (trimmed) text.
  onSave: (content: string) => void
  onCancel: () => void
}

interface ComposerProps {
  // Receives the checked (trimmed) text.
  onSend: (content: string) => void
  // Receives each picked, pasted or dropped file that passed the checks.
  onSendFile: (file: Blob, checked: CheckedFile) => void
  editing?: ComposerEditing | null
}

// Render with a `key` made of the conversation id and the id of the message being edited,
// so each conversation and each edit starts with its own draft.
export function Composer({ onSend, onSendFile, editing = null }: ComposerProps) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState(editing?.content ?? '')
  // The first rejected file of the last pick, paste or drop.
  const [fileError, setFileError] = useState<FileCheckErrorKey | null>(null)
  const [dragging, setDragging] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const errorId = useId()

  // `length` counts UTF-16 units, never fewer than code points, so the exact count is
  // only needed for long drafts.
  const tooLong = draft.length > MESSAGE_MAX_LENGTH && [...draft].length > MESSAGE_MAX_LENGTH
  const canSend = draft.trim() !== '' && !tooLong && !editing?.saving

  useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(textarea.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`
  }, [draft])

  // Editing starts with the cursor after the text.
  const startsEditing = editing !== null
  useEffect(() => {
    const textarea = textareaRef.current
    if (!startsEditing || !textarea) return
    textarea.focus()
    textarea.setSelectionRange(textarea.value.length, textarea.value.length)
  }, [startsEditing])

  // Empty text is ignored; too long text is explained below the box.
  function submit() {
    const checked = checkTextMessage(draft)
    if (!checked.ok) return
    if (editing) {
      if (!editing.saving) editing.onSave(checked.content)
      return
    }
    onSend(checked.content)
    setDraft('')
    textareaRef.current?.focus()
  }

  // Each file is sent as its own message; rejected ones are explained below the box.
  function handleFiles(files: File[]) {
    // While editing, the box belongs to that message.
    if (editing) return
    let firstError: FileCheckErrorKey | null = null
    for (const file of files) {
      const checked = checkAttachmentFile(file)
      if (checked.ok) onSendFile(file, checked.file)
      else firstError ??= checked.error
    }
    setFileError(firstError)
  }

  // Files dropped anywhere on the page go to the open conversation. AppShell keeps the
  // browser from opening them instead.
  const handleDrop = useEffectEvent((files: File[]) => handleFiles(files))
  useEffect(() => {
    const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false
    const onDragOver = (event: DragEvent) => {
      if (hasFiles(event)) setDragging(true)
    }
    const onDragLeave = (event: DragEvent) => {
      // relatedTarget is null when the pointer leaves the window.
      if (event.relatedTarget === null) setDragging(false)
    }
    const onDrop = (event: DragEvent) => {
      setDragging(false)
      const files = [...(event.dataTransfer?.files ?? [])]
      if (files.length > 0) handleDrop(files)
    }
    document.addEventListener('dragover', onDragOver)
    document.addEventListener('dragleave', onDragLeave)
    document.addEventListener('drop', onDrop)
    return () => {
      document.removeEventListener('dragover', onDragOver)
      document.removeEventListener('dragleave', onDragLeave)
      document.removeEventListener('drop', onDrop)
    }
  }, [])

  // Enter sends and Shift+Enter starts a new line. On touch screens Enter always starts a
  // new line and the button sends. Enter that confirms an IME composition (e.g. a
  // Vietnamese input method) never sends.
  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Escape' && editing) {
      event.preventDefault()
      editing.onCancel()
      return
    }
    if (event.key !== 'Enter' || event.shiftKey) return
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    if (window.matchMedia('(pointer: coarse)').matches) return
    event.preventDefault()
    submit()
  }

  const error = tooLong ? 'chat.errors.messageTooLong' : fileError

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
      className={`border-t px-4 py-3 ${dragging && !editing ? 'border-brand-500 bg-brand-50' : 'border-slate-200'}`}
    >
      {editing && (
        <div className="mb-2 flex items-center justify-between gap-2 rounded-lg bg-brand-50 px-3 py-1.5 text-sm text-brand-700">
          <span className="font-medium">{t('chat.editing')}</span>
          <button
            type="button"
            onClick={editing.onCancel}
            className="rounded px-1 font-medium underline hover:text-brand-600 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-500"
          >
            {t('chat.cancelEdit')}
          </button>
        </div>
      )}
      <div className="flex items-end gap-2">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ATTACHMENT_ACCEPT}
          tabIndex={-1}
          aria-hidden="true"
          className="hidden"
          onChange={(event) => {
            handleFiles([...(event.target.files ?? [])])
            // Picking the same file again must fire another change.
            event.target.value = ''
          }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          aria-label={t('chat.attach')}
          title={t('chat.attach')}
          hidden={editing !== null}
          className="shrink-0 rounded-full p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
          </svg>
        </button>
        <textarea
          ref={textareaRef}
          rows={1}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value)
            setFileError(null)
          }}
          onKeyDown={handleKeyDown}
          onPaste={(event) => {
            // A pasted screenshot or copied file is sent; pasted text is left to the box.
            const files = [...event.clipboardData.files]
            if (files.length === 0) return
            event.preventDefault()
            handleFiles(files)
          }}
          placeholder={t('chat.composerPlaceholder')}
          aria-label={t('chat.composerPlaceholder')}
          aria-invalid={tooLong}
          aria-describedby={error ? errorId : undefined}
          className="min-w-0 flex-1 resize-none rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm leading-5 focus-visible:border-brand-500 focus-visible:outline-2 focus-visible:outline-brand-500 aria-invalid:border-red-500"
        />
        <button
          type="submit"
          disabled={!canSend}
          className="shrink-0 rounded-full bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {editing ? t(editing.saving ? 'chat.saving' : 'chat.save') : t('chat.send')}
        </button>
      </div>
      {error && (
        <p id={errorId} role="alert" className="mt-1 text-xs text-red-700">
          {t(error, { max: MESSAGE_MAX_LENGTH, maxMb: ATTACHMENT_MAX_MB })}
        </p>
      )}
    </form>
  )
}
