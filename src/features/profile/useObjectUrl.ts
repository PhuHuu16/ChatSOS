import { useCallback, useEffect, useState } from 'react'

// A blob: URL for showing a local file (e.g. an avatar preview). Each URL is revoked by the
// effect cleanup that runs after React has committed its replacement or unmounted the
// component, so an <img> never points at an already revoked URL.
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
