import { useState } from 'react'
import { getAvatarColorClass, getInitials } from '../features/chat/helpers'
import { useAvatarUrl } from '../features/profile/avatars'

const SIZE_CLASSES = {
  sm: 'size-9 text-xs',
  md: 'size-11 text-sm',
  lg: 'size-24 text-2xl',
} as const

interface AvatarProps {
  id: string
  name: string
  avatarPath?: string | null
  size?: keyof typeof SIZE_CLASSES
  shape?: 'circle' | 'square'
}

// Ảnh đại diện
export function Avatar({ id, name, avatarPath = null, size = 'md', shape = 'circle' }: AvatarProps) {
  const { url, canRetry, retry } = useAvatarUrl(avatarPath)
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null)
  const [failedUrl, setFailedUrl] = useState<string | null>(null)

  function handleError() {
    setFailedUrl(url)
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
