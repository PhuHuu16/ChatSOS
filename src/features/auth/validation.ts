import type { Translation } from '../../i18n/locales/vi'

type ValidationKey = keyof Translation['auth']['validation']
export type ValidationErrorKey = `auth.validation.${ValidationKey}`

export const USERNAME_PATTERN = /^[a-z0-9_]{3,32}$/
export const PASSWORD_MIN_LENGTH = 8
export const DISPLAY_NAME_MAX_LENGTH = 64

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+$/

const PHONE_SEPARATORS = /[\s.()-]/g
const PHONE_LOCAL = /^0[35789][0-9]{8}$/
const PHONE_COUNTRY = /^84[35789][0-9]{8}$/
const PHONE_STORED = /^\+84[35789][0-9]{8}$/

function characterCount(value: string): number {
  return [...value].length
}

function hasControlCharacter(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true
  }
  return false
}

export function normalizeUsernameInput(value: string): string {
  return value.toLowerCase()
}

// Kiểm tra dữ liệu nhập
export function validateUsername(value: string): ValidationErrorKey | null {
  const username = value.trim()
  if (!username) return 'auth.validation.required'
  if (!USERNAME_PATTERN.test(username)) return 'auth.validation.usernameFormat'
  return null
}

export function validateDisplayName(value: string): ValidationErrorKey | null {
  const displayName = value.trim()
  if (!displayName) return 'auth.validation.required'
  if (characterCount(displayName) > DISPLAY_NAME_MAX_LENGTH) {
    return 'auth.validation.displayNameLength'
  }
  if (hasControlCharacter(displayName)) return 'auth.validation.displayNameInvalid'
  return null
}

export function validateEmail(value: string): ValidationErrorKey | null {
  const email = value.trim()
  if (!email) return 'auth.validation.required'
  if (!EMAIL_PATTERN.test(email)) return 'auth.validation.emailInvalid'
  return null
}

export function normalizePhone(value: string): string | null {
  const digits = value.replace(PHONE_SEPARATORS, '')
  if (PHONE_LOCAL.test(digits)) return `+84${digits.slice(1)}`
  if (PHONE_COUNTRY.test(digits)) return `+${digits}`
  if (PHONE_STORED.test(digits)) return digits
  return null
}

export function validatePhone(value: string): ValidationErrorKey | null {
  if (!value.trim()) return 'auth.validation.required'
  if (normalizePhone(value) === null) return 'auth.validation.phoneInvalid'
  return null
}

export type SignInIdentifier = { kind: 'email'; email: string } | { kind: 'phone'; phone: string }

export function toSignInIdentifier(value: string): SignInIdentifier | null {
  const trimmed = value.trim()
  if (trimmed.includes('@')) {
    return validateEmail(trimmed) === null ? { kind: 'email', email: trimmed } : null
  }
  const phone = normalizePhone(trimmed)
  return phone === null ? null : { kind: 'phone', phone }
}

export function validateSignInIdentifier(value: string): ValidationErrorKey | null {
  if (!value.trim()) return 'auth.validation.required'
  if (toSignInIdentifier(value) === null) return 'auth.validation.signInIdInvalid'
  return null
}

export function validatePassword(value: string): ValidationErrorKey | null {
  if (!value) return 'auth.validation.required'
  if (characterCount(value) < PASSWORD_MIN_LENGTH) {
    return 'auth.validation.passwordTooShort'
  }
  return null
}

const RECOVERY_CODE_PATTERN = /^[0-9]{6,10}$/

export function normalizeRecoveryCode(value: string): string | null {
  const code = value.replace(/\s/g, '')
  return RECOVERY_CODE_PATTERN.test(code) ? code : null
}

export function validateRecoveryCode(value: string): ValidationErrorKey | null {
  if (!value.trim()) return 'auth.validation.required'
  if (normalizeRecoveryCode(value) === null) return 'auth.validation.recoveryCodeInvalid'
  return null
}

export function validatePasswordConfirmation(
  password: string,
  confirmation: string,
): ValidationErrorKey | null {
  if (!confirmation) return 'auth.validation.required'
  if (confirmation !== password) return 'auth.validation.passwordMismatch'
  return null
}
