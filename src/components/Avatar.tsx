import { useState } from 'react'
import { getAvatarColorClass, getInitials } from '../features/chat/helpers'
import { useAvatarUrl } from '../features/profile/avatars'

// Full class names so Tailwind can find them when scanning the source.
const SIZE_CLASSES = {
  sm: 'size-9 text-xs',
  md: 'size-11 text-sm',
  lg: 'size-24 text-2xl',
} as const

interface AvatarProps {
  id: string
  name: string
  // The user's photo in the avatars bucket; the initials are shown without one.
  avatarPath?: string | null
  size?: keyof typeof SIZE_CLASSES
  // 'square' (rounded corners) marks a group; people are round.
  shape?: 'circle' | 'square'
}

// Decorative: the name is always rendered as text next to it. The initials stay underneath
// the photo, so they show while it loads and whenever it cannot be shown.
export function Avatar({ id, name, avatarPath = null, size = 'md', shape = 'circle' }: AvatarProps) {
  const { url, canRetry, retry } = useAvatarUrl(avatarPath)
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null)
  const [failedUrl, setFailedUrl] = useState<string | null>(null)

  function handleError() {
    setFailedUrl(url)
    // E.g. the URL expired: one fresh URL is asked for, then the initials stay.
    if (canRetry) retry()
  }

  return (
    <span
      aria-hidden="true"
      className={`relative flex shrink-0 items-center justify-center overflow-hidden ${shape === 'square' ? 'rounded-lg' : 'rounded-full'} font-semibold text-white ${SIZE_CLASSES[size]} ${getAvatarColorClass(id)}`}
    >
      {getInitials(name)}
      {url && url !== failedUrl && (
        <img
          src={url}
          alt=""
          onLoad={() => setLoadedUrl(url)}
          onError={handleError}
          className={`absolute inset-0 size-full object-cover ${loadedUrl === url ? '' : 'invisible'}`}
        />
      )}
    </span>
  )
}
