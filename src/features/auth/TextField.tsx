import { useId, type ComponentPropsWithoutRef, type ReactNode } from 'react'

export interface TextFieldProps
  extends Omit<
    ComponentPropsWithoutRef<'input'>,
    'id' | 'className' | 'aria-invalid' | 'aria-describedby'
  > {
  label: string
  // Already translated. Shown under the input and linked to it for screen readers.
  error?: string | null
  // Placed inside the right edge of the input, e.g. the show-password button.
  trailing?: ReactNode
  // Placed at the right end of the label row, e.g. the forgot-password link.
  labelAside?: ReactNode
}

// Styled for the dark sign-in card (AuthLayout).
// Inputs use 16px text (text-base): smaller text makes iOS Safari zoom in on focus.
export function TextField({ label, error, trailing, labelAside, ...inputProps }: TextFieldProps) {
  const id = useId()
  const errorId = `${id}-error`

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="block text-sm font-medium text-zinc-100">
          {label}
        </label>
        {labelAside}
      </div>
      <div className="relative mt-1.5">
        <input
          {...inputProps}
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className={`auth-input block w-full rounded-lg border bg-white/8 px-3 py-2 text-base text-white placeholder:text-zinc-400 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-auth-focus disabled:opacity-60 ${
            error ? 'border-red-400' : 'border-white/25'
          } ${trailing ? 'pr-12' : ''}`}
        />
        {trailing && (
          <div className="absolute inset-y-0 right-0 flex items-center pr-1">{trailing}</div>
        )}
      </div>
      {error && (
        <p id={errorId} className="mt-1 text-sm text-red-300">
          {error}
        </p>
      )}
    </div>
  )
}
