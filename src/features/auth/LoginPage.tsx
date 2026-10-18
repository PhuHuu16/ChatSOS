import { useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from '../../routing/Link'
import { PATHS } from '../../routing/navigation'
import { AuthLayout } from './AuthLayout'
import type { AuthErrorKey } from './authContext'
import { PasswordInput } from './PasswordInput'
import { TextField } from './TextField'
import { useAuth } from './useAuth'
import { validateEmail, type ValidationErrorKey } from './validation'

// Signing in only needs a password to be entered: the length rule applies to new
// passwords, and Supabase Auth decides whether this one is correct.
function validatePasswordEntered(value: string): ValidationErrorKey | null {
  return value ? null : 'auth.validation.required'
}

export function LoginPage() {
  const { t } = useTranslation()
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  // Field errors appear after the first submit attempt, then always follow the current
  // values, including a password cleared after a failed sign-in.
  const [submitted, setSubmitted] = useState(false)
  const [pending, setPending] = useState(false)
  const [serverError, setServerError] = useState<AuthErrorKey | null>(null)
  // Blocks a second submit before the pending state has re-rendered the form.
  const pendingRef = useRef(false)

  const emailError = submitted ? validateEmail(email) : null
  const passwordError = submitted ? validatePasswordEntered(password) : null

  // Editing a field makes the previous server error out of date.
  function handleEmailChange(value: string) {
    setEmail(value)
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
    if (validateEmail(email) || validatePasswordEntered(password)) return

    pendingRef.current = true
    setPending(true)
    const result = await signIn(email.trim(), password)
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
        <TextField
          label={t('auth.fields.email')}
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          value={email}
          onChange={(event) => handleEmailChange(event.target.value)}
          error={emailError && t(emailError)}
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
