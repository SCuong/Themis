import type { ReplyImageSource } from '../group/types'

const MAX_INLINE_IMAGE_BYTES = 25 * 1024 * 1024

// blob: (and data:) images exist only inside the site page, so their bytes travel with the reply as a data URL.
// An image that cannot be read keeps only its source; the background then records it as a failed attachment.
export async function inlineReplyImages(images: ReplyImageSource[] | undefined, fetchImage: typeof fetch = fetch): Promise<ReplyImageSource[] | undefined> {
  if (!images?.length) return images
  return Promise.all(images.map(async image => {
    if (!/^(blob|data):/i.test(image.sourceUrl)) return image
    try {
      const blob = await (await fetchImage(image.sourceUrl)).blob()
      if (blob.size > MAX_INLINE_IMAGE_BYTES) return image
      const bytes = new Uint8Array(await blob.arrayBuffer())
      // ChatGPT serves its charts as application/octet-stream; the bytes say what they are.
      const type = blob.type.startsWith('image/') ? blob.type : sniffImageType(bytes)
      return type ? { ...image, dataUrl: `data:${type};base64,${toBase64(bytes)}` } : image
    } catch {
      return image
    }
  }))
}

function sniffImageType(bytes: Uint8Array): string | undefined {
  const starts = (...signature: number[]) => signature.every((byte, index) => bytes[index] === byte)
  if (starts(0x89, 0x50, 0x4e, 0x47)) return 'image/png'
  if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg'
  if (starts(0x47, 0x49, 0x46, 0x38)) return 'image/gif'
  if (starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp'
  return undefined
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  return btoa(binary)
}
