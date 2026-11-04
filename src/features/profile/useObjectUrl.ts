import { useCallback, useEffect, useState } from 'react'

export function useObjectUrl(): [string | null, (blob: Blob | null) => void] {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (url === null) return
    return () => URL.revokeObjectURL(url)
  }, [url])

  const setBlob = useCallback((blob: Blob | null) => {
    setUrl(blob ? URL.createObjectURL(blob) : null)
  }, [])

  return [url, setBlob]
}
