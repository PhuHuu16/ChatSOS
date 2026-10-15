import { getAvatarColorClass, getInitials } from '../features/chat/helpers'

interface AvatarProps {
  id: string
  name: string
}

// Decorative: the name is always rendered as text next to it.
export function Avatar({ id, name }: AvatarProps) {
  return (
    <span
      aria-hidden="true"
      className={`flex size-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white ${getAvatarColorClass(id)}`}
    >
      {getInitials(name)}
    </span>
  )
}
