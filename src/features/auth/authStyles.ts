// Shared classes for the sign-in pages: light text on the dark glass card (AuthLayout),
// the same in both themes.

const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-auth-focus'

export const primaryButton = `w-full rounded-lg bg-accent px-5 py-2.5 text-base font-semibold text-white hover:bg-accent-hover ${focusRing} disabled:cursor-not-allowed disabled:opacity-60`

export const secondaryButton = `w-full rounded-lg border border-white/25 px-5 py-2.5 text-base font-medium text-white hover:bg-white/10 ${focusRing} disabled:cursor-not-allowed disabled:opacity-60`

export const textButton = `text-sm font-medium text-auth-link hover:underline ${focusRing} disabled:cursor-not-allowed disabled:text-zinc-400 disabled:no-underline`

export const authLink = `font-medium text-auth-link hover:underline ${focusRing}`

export const errorAlert = 'rounded-lg border border-red-400/30 bg-red-500/15 px-3 py-2 text-sm text-red-100'

export const infoAlert = 'rounded-lg border border-sky-300/30 bg-sky-400/15 px-3 py-2 text-sm text-sky-100'

export const introText = 'text-sm text-zinc-200'

// Theme and language controls in the top corner.
export const cornerControl = `rounded-lg border border-white/25 bg-auth-control text-zinc-100 hover:bg-white/10 ${focusRing}`
