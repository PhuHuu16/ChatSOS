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
import { ICON_PROPS } from './iconProps'

const MAX_TEXTAREA_HEIGHT = 160

const FOCUS_RING = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'
const ICON_BUTTON = `inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-subtle hover:text-fg ${FOCUS_RING}`

export interface ComposerEditing {
  content: string
  saving: boolean
  onSave: (content: string) => void
  onCancel: () => void
}

interface ComposerProps {
  onSend: (content: string) => void
  onSendFile: (file: Blob, checked: CheckedFile) => void
  editing?: ComposerEditing | null
  onTyping?: (typing: boolean) => void
}

// Ô soạn tin nhắn
export function Composer({ onSend, onSendFile, editing = null, onTyping }: ComposerProps) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState(editing?.content ?? '')
  const [fileError, setFileError] = useState<FileCheckErrorKey | null>(null)
  const [dragging, setDragging] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const errorId = useId()

  const tooLong = draft.length > MESSAGE_MAX_LENGTH && [...draft].length > MESSAGE_MAX_LENGTH
  const canSend = draft.trim() !== '' && !tooLong && !editing?.saving

  useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(textarea.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`
  }, [draft])

  const startsEditing = editing !== null
  useEffect(() => {
    const textarea = textareaRef.current
    if (!startsEditing || !textarea) return
    textarea.focus()
    textarea.setSelectionRange(textarea.value.length, textarea.value.length)
  }, [startsEditing])

  function submit() {
    const checked = checkTextMessage(draft)
    if (!checked.ok) return
    if (editing) {
      if (!editing.saving) editing.onSave(checked.content)
      return
    }
    onSend(checked.content)
    onTyping?.(false)
    setDraft('')
    textareaRef.current?.focus()
  }

  function handleFiles(files: File[]) {
    if (editing) return
    let firstError: FileCheckErrorKey | null = null
    for (const file of files) {
      const checked = checkAttachmentFile(file)
      if (checked.ok) onSendFile(file, checked.file)
      else firstError ??= checked.error
    }
    setFileError(firstError)
  }

  const handleDrop = useEffectEvent((files: File[]) => handleFiles(files))
  useEffect(() => {
    const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false
    const onDragOver = (event: DragEvent) => {
      if (hasFiles(event)) setDragging(true)
    }
    const onDragLeave = (event: DragEvent) => {
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
  const boxColours = tooLong
    ? 'border-danger'
    : dragging && !editing
      ? 'border-accent bg-accent-soft'
      : 'border-line focus-within:border-accent focus-within:ring-1 focus-within:ring-accent'

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
      className="px-3 pt-1 pb-3 md:px-5 md:pb-4"
    >
      {editing && (
        <div className="mb-2 flex items-center justify-between gap-2 rounded-lg bg-accent-soft px-3 py-1.5 text-sm text-accent-fg">
          <span className="font-medium">{t('chat.editing')}</span>
          <button
            type="button"
            onClick={editing.onCancel}
            className="rounded px-1 font-medium underline hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
          >
            {t('chat.cancelEdit')}
          </button>
        </div>
      )}
      <div className={`flex items-end gap-1 rounded-xl border bg-surface p-1.5 ${boxColours}`}>
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
            event.target.value = ''
          }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          aria-label={t('chat.attach')}
          title={t('chat.attach')}
          hidden={editing !== null}
          className={ICON_BUTTON}
        >
          <svg {...ICON_PROPS}>
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
            if (!editing) onTyping?.(event.target.value.trim() !== '')
          }}
          onKeyDown={handleKeyDown}
          onPaste={(event) => {
            const files = [...event.clipboardData.files]
            if (files.length === 0) return
            event.preventDefault()
            handleFiles(files)
          }}
          placeholder={t('chat.composerPlaceholder')}
          aria-label={t('chat.composerPlaceholder')}
          aria-invalid={tooLong}
          aria-describedby={error ? errorId : undefined}
          className="min-w-0 flex-1 resize-none bg-transparent px-1.5 py-2 text-base leading-5 text-fg outline-none placeholder:text-muted md:text-sm"
        />
        {editing ? (
          <button
            type="submit"
            disabled={!canSend}
            className={`h-9 shrink-0 rounded-lg bg-accent px-3 text-sm font-semibold text-white hover:bg-accent-hover ${FOCUS_RING} disabled:cursor-not-allowed disabled:opacity-50`}
          >
            {t(editing.saving ? 'chat.saving' : 'chat.save')}
          </button>
        ) : (
          <button
            type="submit"
            disabled={!canSend}
            aria-label={t('chat.send')}
            title={t('chat.send')}
            className={`inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-white hover:bg-accent-hover ${FOCUS_RING} disabled:cursor-not-allowed disabled:opacity-50`}
          >
            <svg {...ICON_PROPS} strokeWidth={2}>
              <path d="M22 2 11 13" />
              <path d="M22 2 15 22l-4-9-9-4Z" />
            </svg>
          </button>
        )}
      </div>
      {error && (
        <p id={errorId} role="alert" className="mt-1 text-xs text-danger">
          {t(error, { max: MESSAGE_MAX_LENGTH, maxMb: ATTACHMENT_MAX_MB })}
        </p>
      )}
    </form>
  )
}
