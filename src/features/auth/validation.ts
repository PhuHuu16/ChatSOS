// Client-side checks for the login and register forms. They mirror the database rules in
// supabase/migrations/20261016000100_profiles.sql (handle_new_user and the profiles
// constraints) to give fast feedback; the server stays the authority.
//
// Every validator returns null when the value is valid, otherwise a translation key.
// Callers must submit the trimmed value they validated (passwords are never trimmed).
import type { Translation } from '../../i18n/locales/vi'

type ValidationKey = keyof Translation['auth']['validation']
export type ValidationErrorKey = `auth.validation.${ValidationKey}`

// Same pattern as handle_new_user and the profiles_username_format constraint.
export const USERNAME_PATTERN = /^[a-z0-9_]{3,32}$/
// Keep in sync with auth.validation.passwordTooShort in the locale files.
export const PASSWORD_MIN_LENGTH = 8
export const DISPLAY_NAME_MAX_LENGTH = 64

// Deliberately minimal: something@something without spaces. Supabase Auth decides.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+$/

// Vietnamese mobile numbers, as private.normalize_vn_phone accepts them (migration 10).
// The separators are those of its [[:space:].()-] class; \s is a little wider than
// [[:space:]], which only matters for input the database would reject anyway.
const PHONE_SEPARATORS = /[\s.()-]/g
const PHONE_LOCAL = /^0[35789][0-9]{8}$/
const PHONE_COUNTRY = /^84[35789][0-9]{8}$/
const PHONE_STORED = /^\+84[35789][0-9]{8}$/

// Postgres char_length counts characters, not UTF-16 code units (an emoji is 1, not 2).
function characterCount(value: string): number {
  return [...value].length
}

// C0 controls, DEL and C1 controls. Postgres [[:cntrl:]] may classify a few more
// characters; the database check still applies to anything this misses.
function hasControlCharacter(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true
  }
  return false
}

// Applied while typing: handle_new_user lowercases the username anyway. Other characters
// are kept so the user sees why the value is rejected instead of losing input silently.
export function normalizeUsernameInput(value: string): string {
  return value.toLowerCase()
}

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

// The stored form (+84xxxxxxxxx) of what the user typed, or null when it is not a
// Vietnamese mobile number. Accepts 0912345678, 84912345678 and +84912345678, with spaces,
// dots, dashes or parentheses anywhere. Mirrors private.normalize_vn_phone and
// normalizePhone in supabase/functions/phone-sign-in/index.ts.
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

// The sign-in field takes an email or a phone number: anything with "@" is an email.
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

// The code from the recovery email: Supabase sends 6 digits by default (up to 10 can be
// configured). Spaces a user may type or paste between digit groups are removed.
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
