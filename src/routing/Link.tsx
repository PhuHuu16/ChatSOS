import type { ComponentPropsWithoutRef, MouseEvent } from 'react'
import { navigate, type AppPath } from './navigation'

interface LinkProps extends Omit<ComponentPropsWithoutRef<'a'>, 'href'> {
  to: AppPath
  replace?: boolean
}

// A regular <a href> that navigates in place on a plain left click. Clicks meant for a new
// tab or window (modifier keys, other buttons, a target) are left to the browser.
export function Link({ to, replace = false, onClick, target, ...rest }: LinkProps) {
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event)
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      (target !== undefined && target !== '_self')
    ) {
      return
    }
    event.preventDefault()
    navigate(to, { replace })
  }

  return <a {...rest} href={to} target={target} onClick={handleClick} />
}
