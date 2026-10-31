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
  normalizePhone,
  normalizeUsernameInput,
  validateDisplayName,
  validateEmail,
  validatePassword,
  validatePasswordConfirmation,
  validatePhone,
  validateUsername,
  type ValidationErrorKey,
} from './validation'

interface RegisterValues {
  username: string
  displayName: string
  email: string
  phone: string
  password: string
  passwordConfirm: string
}

type RegisterErrors = Record<keyof RegisterValues, ValidationErrorKey | null>

const EMPTY_VALUES: RegisterValues = {
  username: '',
  displayName: '',
  email: '',
  phone: '',
  password: '',
  passwordConfirm: '',
}

function validate(values: RegisterValues): RegisterErrors {
  return {
    username: validateUsername(values.username),
    displayName: validateDisplayName(values.displayName),
    email: validateEmail(values.email),
    phone: validatePhone(values.phone),
    password: validatePassword(values.password),
    passwordConfirm: validatePasswordConfirmation(values.password, values.passwordConfirm),
  }
}

function hasErrors(errors: RegisterErrors): boolean {
  return Object.values(errors).some((error) => error !== null)
}

const linkClassName =
  'font-medium text-brand-700 hover:underline focus-visible:outline-2 focus-visible:outline-brand-500'

export function RegisterPage() {
  const { t } = useTranslation()
  const { signUp } = useAuth()
  const [values, setValues] = useState<RegisterValues>(EMPTY_VALUES)
  // Field errors appear after the first submit attempt, then always follow the current
  // values, including passwords cleared after a failed sign-up.
  const [submitted, setSubmitted] = useState(false)
  const [pending, setPending] = useState(false)
  const [serverError, setServerError] = useState<AuthErrorKey | null>(null)
  // Set when the account was created but has no session until the email is confirmed.
  const [confirmationEmail, setConfirmationEmail] = useState<string | null>(null)
  // Blocks a second submit before the pending state has re-rendered the form.
  const pendingRef = useRef(false)

  const errors = submitted ? validate(values) : null

  // Editing a field makes the previous server error out of date.
  function setField(name: keyof RegisterValues, value: string) {
    setValues((current) => ({ ...current, [name]: value }))
    setServerError(null)
  }

  function fieldError(name: keyof RegisterValues): string | null {
    const key = errors?.[name]
    return key ? t(key) : null
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pendingRef.current) return
    setServerError(null)
    setSubmitted(true)
    const phone = normalizePhone(values.phone)
    if (hasErrors(validate(values)) || phone === null) return

    const email = values.email.trim()
    pendingRef.current = true
    setPending(true)
    const result = await signUp({
      email,
      password: values.password,
      username: values.username.trim(),
      displayName: values.displayName.trim(),
      phone,
    })
    pendingRef.current = false
    setPending(false)

    if (!result.ok) {
      setServerError(result.error)
      setValues((current) => ({ ...current, password: '', passwordConfirm: '' }))
    } else if (result.needsEmailConfirmation) {
      setValues(EMPTY_VALUES)
      setConfirmationEmail(email)
    }
    // With a session the route guard leaves this page, so there is nothing to do here.
  }

  if (confirmationEmail !== null) {
    return (
      <AuthLayout
        title={t('auth.register.checkInboxTitle')}
        footer={
          <Link to={PATHS.login} className={linkClassName}>
            {t('auth.register.toLogin')}
          </Link>
        }
      >
        <p role="status" className="text-sm text-slate-600">
          {t('auth.register.checkInboxBody', { email: confirmationEmail })}
        </p>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title={t('auth.register.title')}
      footer={
        <>
          {t('auth.register.hasAccount')}{' '}
          <Link to={PATHS.login} className={linkClassName}>
            {t('auth.register.toLogin')}
          </Link>
        </>
      }
    >
      <form noValidate onSubmit={(event) => void handleSubmit(event)} className="space-y-4">
        <TextField
          label={t('auth.fields.username')}
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={values.username}
          onChange={(event) => setField('username', normalizeUsernameInput(event.target.value))}
          error={fieldError('username')}
          disabled={pending}
        />
        <TextField
          label={t('auth.fields.displayName')}
          name="displayName"
          autoComplete="nickname"
          value={values.displayName}
          onChange={(event) => setField('displayName', event.target.value)}
          error={fieldError('displayName')}
          disabled={pending}
        />
        <TextField
          label={t('auth.fields.email')}
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          value={values.email}
          onChange={(event) => setField('email', event.target.value)}
          error={fieldError('email')}
          disabled={pending}
        />
        <TextField
          label={t('auth.fields.phone')}
          type="tel"
          name="phone"
          autoComplete="tel"
          inputMode="tel"
          placeholder={t('auth.fields.phonePlaceholder')}
          value={values.phone}
          onChange={(event) => setField('phone', event.target.value)}
          error={fieldError('phone')}
          disabled={pending}
        />
        <PasswordInput
          label={t('auth.fields.password')}
          name="password"
          autoComplete="new-password"
          value={values.password}
          onChange={(event) => setField('password', event.target.value)}
          error={fieldError('password')}
          disabled={pending}
        />
        <PasswordInput
          label={t('auth.fields.passwordConfirm')}
          name="passwordConfirm"
          autoComplete="new-password"
          value={values.passwordConfirm}
          onChange={(event) => setField('passwordConfirm', event.target.value)}
          error={fieldError('passwordConfirm')}
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
          {pending ? t('auth.register.submitting') : t('auth.register.submit')}
        </button>
      </form>
    </AuthLayout>
  )
}
