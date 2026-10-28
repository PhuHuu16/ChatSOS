import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { checkTextMessage, MESSAGE_MAX_LENGTH } from '../features/chat/api'

// The text box grows with its content up to this height (px), then scrolls.
const MAX_TEXTAREA_HEIGHT = 160

interface ComposerProps {
  // Receives the checked (trimmed) text.
  onSend: (content: string) => void
}

// Render with `key` = conversation id so each conversation starts with an empty draft.
export function Composer({ onSend }: ComposerProps) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const errorId = useId()

  // `length` counts UTF-16 units, never fewer than code points, so the exact count is
  // only needed for long drafts.
  const tooLong = draft.length > MESSAGE_MAX_LENGTH && [...draft].length > MESSAGE_MAX_LENGTH
  const canSend = draft.trim() !== '' && !tooLong

  useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(textarea.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`
  }, [draft])

  // Empty text is ignored; too long text is explained below the box.
  function submit() {
    const checked = checkTextMessage(draft)
    if (!checked.ok) return
    onSend(checked.content)
    setDraft('')
    textareaRef.current?.focus()
  }

  // Enter sends and Shift+Enter starts a new line. On touch screens Enter always starts a
  // new line and the button sends. Enter that confirms an IME composition (e.g. a
  // Vietnamese input method) never sends.
  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey) return
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    if (window.matchMedia('(pointer: coarse)').matches) return
    event.preventDefault()
    submit()
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
      className="border-t border-slate-200 px-4 py-3"
    >
      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          rows={1}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('chat.composerPlaceholder')}
          aria-label={t('chat.composerPlaceholder')}
          aria-invalid={tooLong}
          aria-describedby={tooLong ? errorId : undefined}
          className="min-w-0 flex-1 resize-none rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm leading-5 focus-visible:border-brand-500 focus-visible:outline-2 focus-visible:outline-brand-500 aria-invalid:border-red-500"
        />
        <button
          type="submit"
          disabled={!canSend}
          className="shrink-0 rounded-full bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t('chat.send')}
        </button>
      </div>
      {tooLong && (
        <p id={errorId} role="alert" className="mt-1 text-xs text-red-700">
          {t('chat.errors.messageTooLong', { max: MESSAGE_MAX_LENGTH })}
        </p>
      )}
    </form>
  )
}
