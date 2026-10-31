import { useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from '../../routing/Link'
import { PATHS } from '../../routing/navigation'
import { AuthLayout } from './AuthLayout'
import type { AuthErrorKey } from './authContext'
import { PasswordInput } from './PasswordInput'
import { TextField } from './TextField'
import { useAuth } from './useAuth'
import {
  toSignInIdentifier,
  validateSignInIdentifier,
  type ValidationErrorKey,
} from './validation'

// Signing in only needs a password to be entered: the length rule applies to new
// passwords, and Supabase Auth decides whether this one is correct.
function validatePasswordEntered(value: string): ValidationErrorKey | null {
  return value ? null : 'auth.validation.required'
}

export function LoginPage() {
  const { t } = useTranslation()
  const { signIn } = useAuth()
  // An email address or a phone number, see toSignInIdentifier.
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  // Field errors appear after the first submit attempt, then always follow the current
  // values, including a password cleared after a failed sign-in.
  const [submitted, setSubmitted] = useState(false)
  const [pending, setPending] = useState(false)
  const [serverError, setServerError] = useState<AuthErrorKey | null>(null)
  // Blocks a second submit before the pending state has re-rendered the form.
  const pendingRef = useRef(false)

  const identifierError = submitted ? validateSignInIdentifier(identifier) : null
  const passwordError = submitted ? validatePasswordEntered(password) : null

  // Editing a field makes the previous server error out of date.
  function handleIdentifierChange(value: string) {
    setIdentifier(value)
    setServerError(null)
  }

  function handlePasswordChange(value: string) {
    setPassword(value)
    setServerError(null)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pendingRef.current) return
    setServerError(null)
    setSubmitted(true)
    const parsed = toSignInIdentifier(identifier)
    if (parsed === null || validatePasswordEntered(password)) return

    pendingRef.current = true
    setPending(true)
    const result = await signIn(parsed, password)
    pendingRef.current = false
    setPending(false)

    // On success the route guard leaves this page, so there is nothing to do here.
    if (!result.ok) {
      setServerError(result.error)
      setPassword('')
    }
  }

  return (
    <AuthLayout
      title={t('auth.login.title')}
      footer={
        <>
          {t('auth.login.noAccount')}{' '}
          <Link
            to={PATHS.register}
            className="font-medium text-brand-700 hover:underline focus-visible:outline-2 focus-visible:outline-brand-500"
          >
            {t('auth.login.toRegister')}
          </Link>
        </>
      }
    >
      <form noValidate onSubmit={(event) => void handleSubmit(event)} className="space-y-4">
        {/* type="text": an email keyboard would make typing a phone number awkward. */}
        <TextField
          label={t('auth.fields.signInId')}
          type="text"
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={identifier}
          onChange={(event) => handleIdentifierChange(event.target.value)}
          error={identifierError && t(identifierError)}
          disabled={pending}
        />
        <PasswordInput
          label={t('auth.fields.password')}
          name="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => handlePasswordChange(event.target.value)}
          error={passwordError && t(passwordError)}
          disabled={pending}
        />
        <div className="-mt-2 text-right">
          <Link
            to={PATHS.forgotPassword}
            className="text-sm font-medium text-brand-700 hover:underline focus-visible:outline-2 focus-visible:outline-brand-500"
          >
            {t('auth.login.forgotPassword')}
          </Link>
        </div>

        {serverError && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {t(serverError)}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-full bg-brand-500 px-5 py-2.5 text-base font-medium text-white hover:bg-brand-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? t('auth.login.submitting') : t('auth.login.submit')}
        </button>
      </form>
    </AuthLayout>
  )
}
