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
    errors: {
      network: "Couldn't reach the server. Check your connection and try again.",
      loadFailed: "Couldn't load the chat. Please try again.",
      sendFailed: "Couldn't send the message. Please try again.",
      notAllowed: "You can't do this, or your session has expired.",
      messageEmpty: "The message can't be empty.",
      messageTooLong: 'A message can be at most {{max}} characters.',
    },
  },
  auth: {
    loading: 'Loading…',
    logout: 'Sign out',
    loggingOut: 'Signing out…',
    fields: {
      username: 'Username',
      displayName: 'Display name',
      email: 'Email',
      password: 'Password',
      passwordConfirm: 'Confirm password',
      showPassword: 'Show password',
      hidePassword: 'Hide password',
    },
    login: {
      title: 'Sign in',
      submit: 'Sign in',
      submitting: 'Signing in…',
      noAccount: "Don't have an account?",
      toRegister: 'Sign up',
    },
    register: {
      title: 'Create account',
      submit: 'Sign up',
      submitting: 'Creating account…',
      hasAccount: 'Already have an account?',
      toLogin: 'Sign in',
      checkInboxTitle: 'Check your inbox',
      checkInboxBody:
        'If {{email}} is valid, you will receive a confirmation email. Open the link in it, then sign in.',
    },
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
      signOutFailed: "Couldn't sign out. Check your connection and try again.",
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
