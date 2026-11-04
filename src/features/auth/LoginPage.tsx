import { useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from '../../routing/Link'
import { PATHS } from '../../routing/navigation'
import { AuthLayout } from './AuthLayout'
import type { AuthErrorKey } from './authContext'
import { authLink, errorAlert, primaryButton } from './authStyles'
import { PasswordInput } from './PasswordInput'
import { TextField } from './TextField'
import { useAuth } from './useAuth'
import {
  toSignInIdentifier,
  validateSignInIdentifier,
  type ValidationErrorKey,
} from './validation'

function validatePasswordEntered(value: string): ValidationErrorKey | null {
  return value ? null : 'auth.validation.required'
}

// Đăng nhập
export function LoginPage() {
  const { t } = useTranslation()
  const { signIn } = useAuth()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [pending, setPending] = useState(false)
  const [serverError, setServerError] = useState<AuthErrorKey | null>(null)
  const pendingRef = useRef(false)

  const identifierError = submitted ? validateSignInIdentifier(identifier) : null
  const passwordError = submitted ? validatePasswordEntered(password) : null

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
          <Link to={PATHS.register} className={authLink}>
            {t('auth.login.toRegister')}
          </Link>
        </>
      }
    >
      <form noValidate onSubmit={(event) => void handleSubmit(event)} className="space-y-4">
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
          labelAside={
            <Link to={PATHS.forgotPassword} className={`text-sm ${authLink}`}>
              {t('auth.login.forgotPassword')}
            </Link>
          }
        />

        {serverError && (
          <p role="alert" className={errorAlert}>
            {t(serverError)}
          </p>
        )}

        <button type="submit" disabled={pending} className={primaryButton}>
          {pending ? t('auth.login.submitting') : t('auth.login.submit')}
        </button>
      </form>
    </AuthLayout>
  )
}
