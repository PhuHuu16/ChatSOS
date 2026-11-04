const FOCUS_RING = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'
const BUTTON_BASE = `inline-flex h-9 shrink-0 items-center justify-center rounded-lg px-3.5 text-sm ${FOCUS_RING} disabled:cursor-not-allowed disabled:opacity-60`

export const DIALOG =
  'm-auto w-[calc(100%-2rem)] max-w-md rounded-xl border border-line bg-surface p-0 text-fg shadow-2xl backdrop:bg-zinc-950/50'
export const DIALOG_HEADER = 'flex justify-between gap-2 border-b border-line py-2.5 pr-3 pl-5'
export const DIALOG_TITLE = 'text-base font-semibold'
export const DIALOG_FOOTER = 'flex gap-2 border-t border-line px-5 py-3'
export const CLOSE_BUTTON = `inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-subtle hover:text-fg ${FOCUS_RING} disabled:opacity-60`

export const FIELD_LABEL = 'flex flex-col gap-1.5 text-sm font-medium'
export const INPUT =
  'h-9 rounded-lg border border-line-strong bg-canvas px-3 text-base font-normal text-fg placeholder:text-muted focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-accent disabled:opacity-60 md:text-sm'

export const PRIMARY_BUTTON = `${BUTTON_BASE} bg-accent font-semibold text-white hover:bg-accent-hover`
export const SECONDARY_BUTTON = `${BUTTON_BASE} border border-line-strong bg-surface font-medium text-fg hover:bg-subtle`
export const GHOST_BUTTON = `${BUTTON_BASE} font-medium text-fg hover:bg-subtle`
export const DANGER_OUTLINE_BUTTON = `${BUTTON_BASE} border border-line-strong bg-surface font-medium text-danger hover:bg-danger-soft`
export const DANGER_BUTTON = `${BUTTON_BASE} bg-danger-solid font-semibold text-white hover:opacity-90`
export const SMALL_BUTTON = `rounded-md px-2 py-1 text-xs font-medium ${FOCUS_RING} disabled:cursor-not-allowed disabled:opacity-60`

export const CHIP = `flex items-center gap-1 rounded-full bg-accent-soft px-3 py-1 text-sm text-accent-fg hover:opacity-80 ${FOCUS_RING} disabled:opacity-60`
export const RESULT_ROW =
  'flex w-full items-center gap-3 px-5 py-2 text-left hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60'
export const SECTION_HEADING = 'text-xs font-semibold tracking-wide text-muted uppercase'
export const ERROR_BAR = 'border-t border-line bg-danger-soft px-5 py-2 text-sm text-danger'
