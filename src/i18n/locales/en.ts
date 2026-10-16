import type { Translation } from './vi'

export const en: Translation = {
  app: { name: 'ChatSOS' },
  language: { label: 'Language', vi: 'Tiếng Việt', en: 'English' },
  chat: {
    listLabel: 'Chats',
    emptyState: 'Select a chat to start messaging',
    members_one: '{{count}} member',
    members_other: '{{count}} members',
    direct: 'Private chat',
    you: 'You',
    back: 'Back',
    composerPlaceholder: 'Write a message…',
    send: 'Send',
    previewNotice: 'Preview mode: sending messages is not available yet',
  },
  auth: {
    validation: {
      required: 'This field is required',
      usernameFormat:
        'Username must be 3–32 characters: lowercase letters, digits or underscores',
      displayNameLength: 'Display name must be 1 to 64 characters',
      displayNameInvalid: 'Display name contains invalid characters',
      emailInvalid: 'Invalid email address',
      passwordTooShort: 'Password must be at least 8 characters',
      passwordMismatch: 'Passwords do not match',
    },
    errors: {
      invalidCredentials: 'Incorrect email or password',
      emailNotConfirmed: 'Your email is not confirmed yet. Please check your inbox.',
      emailAlreadyRegistered: 'This email is already registered',
      weakPassword: 'The password is too weak. Please choose another one.',
      emailInvalid: 'Invalid email address',
      signupDisabled: 'Sign-ups are currently disabled',
      rateLimited: 'Too many attempts. Please try again later.',
      network: "Couldn't reach the server. Check your connection and try again.",
      signupFailed:
        "Couldn't create the account. Please check your details and try again. If the problem continues, try a different username.",
      unexpected: 'Something went wrong. Please try again.',
    },
  },
  config: {
    title: 'Server connection not configured',
    description:
      'ChatSOS is not configured to connect to its server. Please contact the administrator.',
    loadFailedTitle: "Couldn't load the app",
    loadFailedDescription:
      'Something went wrong while loading ChatSOS. Check your connection and try again.',
    reload: 'Reload',
  },
}
