// Turns a picked photo into the avatar file: a 256x256 JPEG drawn again from the decoded
// pixels, so nothing of the original file (EXIF, GPS position, other metadata) is kept.
// Runs entirely in the browser; the original file is never uploaded, stored or logged.

export const AVATAR_SIZE = 256
// Same as the avatars bucket's file_size_limit.
export const AVATAR_MAX_BYTES = 1024 * 1024
export const AVATAR_INPUT_MAX_MB = 20
export const AVATAR_INPUT_MAX_MEGAPIXELS = 40

const INPUT_TYPES: readonly string[] = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const INPUT_MAX_BYTES = AVATAR_INPUT_MAX_MB * 1024 * 1024
const MAX_PIXELS = AVATAR_INPUT_MAX_MEGAPIXELS * 1_000_000
// A second, lower quality is tried only when the first result is above the target.
const QUALITY_STEPS = [0.85, 0.7] as const
const TARGET_BYTES = 200 * 1024

// For the file picker's `accept` attribute.
export const AVATAR_INPUT_ACCEPT = INPUT_TYPES.join(',')

export type AvatarImageErrorKey =
  | 'profile.errors.imageType'
  | 'profile.errors.imageTooLarge'
  | 'profile.errors.imageDecode'
  | 'profile.errors.imageEncode'
  | 'profile.errors.imageUnsupported'

export type AvatarImageResult = { ok: true; blob: Blob } | { ok: false; error: AvatarImageErrorKey }

// Checks what can be known before decoding. The 20 MB limit does not stop every
// "decompression bomb" (a small file with huge dimensions); decoding failures are
// handled separately, and the pixel count is checked once the size is known.
export function checkAvatarInput(file: { type: string; size: number }): AvatarImageErrorKey | null {
  if (!INPUT_TYPES.includes(file.type)) return 'profile.errors.imageType'
  if (file.size < 1) return 'profile.errors.imageDecode'
  if (file.size > INPUT_MAX_BYTES) return 'profile.errors.imageTooLarge'
  return null
}

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob(resolve, 'image/jpeg', quality)
    } catch {
      resolve(null)
    }
  })
}

export async function prepareAvatarImage(file: Blob): Promise<AvatarImageResult> {
  const inputError = checkAvatarInput(file)
  if (inputError) return { ok: false, error: inputError }
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') {
    return { ok: false, error: 'profile.errors.imageUnsupported' }
  }

  let bitmap: ImageBitmap | null = null
  const canvas = document.createElement('canvas')
  try {
    try {
      // 'from-image' applies the photo's EXIF orientation, so phone photos stand upright.
      bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch {
      return { ok: false, error: 'profile.errors.imageDecode' }
    }
    const { width, height } = bitmap
    if (width < 1 || height < 1) return { ok: false, error: 'profile.errors.imageDecode' }
    if (width * height > MAX_PIXELS) return { ok: false, error: 'profile.errors.imageTooLarge' }

    canvas.width = AVATAR_SIZE
    canvas.height = AVATAR_SIZE
    const context = canvas.getContext('2d')
    if (!context || typeof canvas.toBlob !== 'function') {
      return { ok: false, error: 'profile.errors.imageUnsupported' }
    }
    // The centre square of the photo, scaled to fit. White shows through transparent
    // pixels, which JPEG cannot store.
    const side = Math.min(width, height)
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, AVATAR_SIZE, AVATAR_SIZE)
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(
      bitmap,
      (width - side) / 2,
      (height - side) / 2,
      side,
      side,
      0,
      0,
      AVATAR_SIZE,
      AVATAR_SIZE,
    )

    let blob: Blob | null = null
    for (const quality of QUALITY_STEPS) {
      blob = await toJpeg(canvas, quality)
      if (!blob || blob.size <= TARGET_BYTES) break
    }
    if (!blob || blob.type !== 'image/jpeg' || blob.size < 1 || blob.size > AVATAR_MAX_BYTES) {
      return { ok: false, error: 'profile.errors.imageEncode' }
    }
    return { ok: true, blob }
  } catch {
    // e.g. drawImage refusing the bitmap, or the browser running out of memory.
    return { ok: false, error: 'profile.errors.imageEncode' }
  } finally {
    bitmap?.close()
    // Releases the canvas's pixel memory now instead of whenever it is collected.
    canvas.width = 0
    canvas.height = 0
  }
}
