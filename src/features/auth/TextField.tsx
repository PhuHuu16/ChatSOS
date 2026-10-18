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
}

// Inputs use 16px text (text-base): smaller text makes iOS Safari zoom in on focus.
export function TextField({ label, error, trailing, ...inputProps }: TextFieldProps) {
  const id = useId()
  const errorId = `${id}-error`

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-slate-700">
        {label}
      </label>
      <div className="relative mt-1">
        <input
          {...inputProps}
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className={`block w-full rounded-lg border bg-white px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-500 disabled:bg-slate-100 ${
            error ? 'border-red-500' : 'border-slate-300'
          } ${trailing ? 'pr-12' : ''}`}
        />
        {trailing && (
          <div className="absolute inset-y-0 right-0 flex items-center pr-1">{trailing}</div>
        )}
      </div>
      {error && (
        <p id={errorId} className="mt-1 text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  )
}
