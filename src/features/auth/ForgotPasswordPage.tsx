import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from '../../routing/Link'
import { PATHS, navigate } from '../../routing/navigation'
import { AuthLayout } from './AuthLayout'
import type { AuthErrorKey } from './authContext'
import { PasswordInput } from './PasswordInput'
import { TextField } from './TextField'
import { useAuth } from './useAuth'
import {
  normalizeRecoveryCode,
  validateEmail,
  validatePassword,
  validatePasswordConfirmation,
  validateRecoveryCode,
} from './validation'

// Password recovery in three steps: email → code from the email → new password.
// Steps 1–2 run signed out. A correct code (or the email's link) signs the user in with
// status 'recovering', and the route guard keeps them here on step 3 until the new
// password is saved or the recovery is cancelled.

// Supabase lets an address request a new email about once a minute.
const RESEND_COOLDOWN_SECONDS = 60

const primaryButton =
  'w-full rounded-full bg-brand-500 px-5 py-2.5 text-base font-medium text-white hover:bg-brand-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:cursor-not-allowed disabled:opacity-60'
const secondaryButton =
  'w-full rounded-full border border-slate-300 px-5 py-2.5 text-base font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:cursor-not-allowed disabled:opacity-60'
const textButton =
  'text-sm font-medium text-brand-700 hover:underline focus-visible:outline-2 focus-visible:outline-brand-500 disabled:cursor-not-allowed disabled:text-slate-400 disabled:no-underline'
const linkClassName =
  'font-medium text-brand-700 hover:underline focus-visible:outline-2 focus-visible:outline-brand-500'

function ServerError({ error }: { error: AuthErrorKey | null }) {
  const { t } = useTranslation()
  if (!error) return null
  return (
    <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
      {t(error)}
    </p>
  )
}

export function ForgotPasswordPage() {
  const { status } = useAuth()
  return status === 'recovering' ? <NewPasswordStep /> : <RequestSteps />
}

// Steps 1 and 2. The answers never tell whether the address has an account.
function RequestSteps() {
  const { t } = useTranslation()
  const { requestPasswordReset, verifyRecoveryCode } = useAuth()
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  // The trimmed address the code was requested for.
  const [sentTo, setSentTo] = useState('')
  const [code, setCode] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [pending, setPending] = useState<'send' | 'verify' | 'resend' | null>(null)
  const [serverError, setServerError] = useState<AuthErrorKey | null>(null)
  const [resent, setResent] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  // Blocks a second submit before the pending state has re-rendered the form.
  const pendingRef = useRef(false)

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setTimeout(() => setCooldown((seconds) => seconds - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  const emailError = submitted && step === 'email' ? validateEmail(email) : null
  const codeError = submitted && step === 'code' ? validateRecoveryCode(code) : null

  async function run<T>(kind: 'send' | 'verify' | 'resend', work: () => Promise<T>): Promise<T | null> {
    if (pendingRef.current) return null
    pendingRef.current = true
    setPending(kind)
    try {
      return await work()
    } finally {
      pendingRef.current = false
      setPending(null)
    }
  }

  async function handleSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pendingRef.current) return
    setServerError(null)
    setSubmitted(true)
    if (validateEmail(email)) return

    const address = email.trim()
    const result = await run('send', () => requestPasswordReset(address))
    if (!result) return
    if (!result.ok) {
      setServerError(result.error)
      return
    }
    setSentTo(address)
    setCode('')
    setSubmitted(false)
    setResent(false)
    setCooldown(RESEND_COOLDOWN_SECONDS)
    setStep('code')
  }

  async function handleVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pendingRef.current) return
    setServerError(null)
    setSubmitted(true)
    const normalized = normalizeRecoveryCode(code)
    if (normalized === null) return

    const result = await run('verify', () => verifyRecoveryCode(sentTo, normalized))
    // On success the status becomes 'recovering' and step 3 replaces this component.
    if (result && !result.ok) {
      setServerError(result.error)
      setCode('')
      setSubmitted(false)
    }
  }

  async function handleResend() {
    setServerError(null)
    setResent(false)
    const result = await run('resend', () => requestPasswordReset(sentTo))
    if (!result) return
    if (!result.ok) {
      setServerError(result.error)
      return
    }
    setResent(true)
    setCooldown(RESEND_COOLDOWN_SECONDS)
  }

  function handleOtherEmail() {
    setStep('email')
    setSubmitted(false)
    setServerError(null)
    setResent(false)
    setCode('')
  }

  const footer = (
    <Link to={PATHS.login} className={linkClassName}>
      {t('auth.forgot.backToLogin')}
    </Link>
  )

  if (step === 'email') {
    return (
      <AuthLayout title={t('auth.forgot.title')} footer={footer}>
        <form noValidate onSubmit={(event) => void handleSend(event)} className="space-y-4">
          <p className="text-sm text-slate-600">{t('auth.forgot.intro')}</p>
          <TextField
            label={t('auth.fields.email')}
            type="email"
            name="email"
            autoComplete="email"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            value={email}
            onChange={(event) => {
              setEmail(event.target.value)
              setServerError(null)
            }}
            error={emailError && t(emailError)}
            disabled={pending !== null}
          />
          <ServerError error={serverError} />
          <button type="submit" disabled={pending !== null} className={primaryButton}>
            {pending === 'send' ? t('auth.forgot.sending') : t('auth.forgot.send')}
          </button>
        </form>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title={t('auth.forgot.codeTitle')} footer={footer}>
      <form noValidate onSubmit={(event) => void handleVerify(event)} className="space-y-4">
        <p role="status" className="text-sm text-slate-600">
          {t('auth.forgot.codeSent', { email: sentTo })}
        </p>
        <TextField
          label={t('auth.fields.recoveryCode')}
          type="text"
          name="one-time-code"
          autoComplete="one-time-code"
          inputMode="numeric"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={20}
          value={code}
          onChange={(event) => {
            setCode(event.target.value)
            setServerError(null)
          }}
          error={codeError && t(codeError)}
          disabled={pending !== null}
        />
        <ServerError error={serverError} />
        {resent && !serverError && (
          <p role="status" className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-700">
            {t('auth.forgot.resent')}
          </p>
        )}
        <button type="submit" disabled={pending !== null} className={primaryButton}>
          {pending === 'verify' ? t('auth.forgot.verifying') : t('auth.forgot.verify')}
        </button>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => void handleResend()}
            disabled={pending !== null || cooldown > 0}
            className={textButton}
          >
            {pending === 'resend'
              ? t('auth.forgot.resending')
              : cooldown > 0
                ? t('auth.forgot.resendIn', { seconds: cooldown })
                : t('auth.forgot.resend')}
          </button>
          <button type="button" onClick={handleOtherEmail} disabled={pending !== null} className={textButton}>
            {t('auth.forgot.otherEmail')}
          </button>
        </div>
      </form>
    </AuthLayout>
  )
}

// Step 3: signed in by the recovery, the new password is not saved yet.
function NewPasswordStep() {
  const { t } = useTranslation()
  const { session, updatePassword, cancelRecovery } = useAuth()
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [pending, setPending] = useState<'save' | 'cancel' | null>(null)
  const [serverError, setServerError] = useState<AuthErrorKey | null>(null)
  const pendingRef = useRef(false)

  const passwordError = submitted ? validatePassword(password) : null
  const confirmationError = submitted ? validatePasswordConfirmation(password, confirmation) : null

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pendingRef.current) return
    setServerError(null)
    setSubmitted(true)
    if (validatePassword(password) || validatePasswordConfirmation(password, confirmation)) return

    pendingRef.current = true
    setPending('save')
    const result = await updatePassword(password)
    pendingRef.current = false
    setPending(null)
    // On success the status becomes 'signedIn' and the route guard opens the app.
    if (!result.ok) {
      setServerError(result.error)
      setPassword('')
      setConfirmation('')
    }
  }

  async function handleCancel() {
    if (pendingRef.current) return
    setServerError(null)
    pendingRef.current = true
    setPending('cancel')
    const result = await cancelRecovery()
    pendingRef.current = false
    setPending(null)
    // Signed out, this page would show step 1 (it is open to signed-out users), so go to
    // the login page instead. ok: false does not say whether the session is gone: if it
    // is, the status already left 'recovering'; if not, the error is shown here.
    if (result.ok) navigate(PATHS.login, { replace: true })
    else setServerError('auth.errors.signOutFailed')
  }

  return (
    <AuthLayout title={t('auth.forgot.newPasswordTitle')}>
      <form noValidate onSubmit={(event) => void handleSave(event)} className="space-y-4">
        <p className="text-sm text-slate-600">{t('auth.forgot.newPasswordIntro')}</p>
        {/* Lets password managers save the new password under the right account. */}
        <input
          type="text"
          name="username"
          autoComplete="username"
          value={session?.user.email ?? ''}
          readOnly
          hidden
        />
        <PasswordInput
          label={t('auth.fields.newPassword')}
          name="new-password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value)
            setServerError(null)
          }}
          error={passwordError && t(passwordError)}
          disabled={pending !== null}
        />
        <PasswordInput
          label={t('auth.fields.newPasswordConfirm')}
          name="new-password-confirm"
          autoComplete="new-password"
          value={confirmation}
          onChange={(event) => {
            setConfirmation(event.target.value)
            setServerError(null)
          }}
          error={confirmationError && t(confirmationError)}
          disabled={pending !== null}
        />
        <ServerError error={serverError} />
        <button type="submit" disabled={pending !== null} className={primaryButton}>
          {pending === 'save' ? t('auth.forgot.saving') : t('auth.forgot.save')}
        </button>
        <button
          type="button"
          onClick={() => void handleCancel()}
          disabled={pending !== null}
          className={secondaryButton}
        >
          {pending === 'cancel' ? t('auth.forgot.cancelling') : t('auth.forgot.cancel')}
        </button>
      </form>
    </AuthLayout>
  )
}
