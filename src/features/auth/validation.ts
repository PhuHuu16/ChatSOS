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

export function validatePassword(value: string): ValidationErrorKey | null {
  if (!value) return 'auth.validation.required'
  if (characterCount(value) < PASSWORD_MIN_LENGTH) {
    return 'auth.validation.passwordTooShort'
  }
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
