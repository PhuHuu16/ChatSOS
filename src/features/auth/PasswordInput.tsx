import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { TextField, type TextFieldProps } from './TextField'

type PasswordInputProps = Omit<TextFieldProps, 'type' | 'trailing'>

// The button's label names the action it performs next; aria-pressed is true while the
// password is shown as text.
export function PasswordInput(props: PasswordInputProps) {
  const { t } = useTranslation()
  const [visible, setVisible] = useState(false)

  return (
    <TextField
      {...props}
      type={visible ? 'text' : 'password'}
      // While the password is visible as text, the keyboard must not alter it.
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
      trailing={
        <button
          type="button"
          aria-label={visible ? t('auth.fields.hidePassword') : t('auth.fields.showPassword')}
          aria-pressed={visible}
          disabled={props.disabled}
          onClick={() => setVisible((current) => !current)}
          className="rounded-md p-2 text-slate-500 hover:text-slate-700 focus-visible:outline-2 focus-visible:outline-brand-500 disabled:opacity-50"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="size-5"
          >
            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
            <circle cx="12" cy="12" r="3" />
            {visible && <path d="M3 3l18 18" />}
          </svg>
        </button>
      }
    />
  )
}
