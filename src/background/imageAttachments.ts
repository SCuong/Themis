import type { MessageImageAttachment, ReplyImageSource } from '../group/types'
import type { ImageAttachmentBlobRecord, ImageAttachmentRepository } from '../shared/imageAttachmentRepository'

const MAX_IMAGE_BYTES = 25 * 1024 * 1024
const CHATGPT_IMAGE_SOURCE_HOSTS = new Set(['chatgpt.com', 'chat.openai.com'])
const OPENAI_IMAGE_HOST_SUFFIXES = ['.chatgpt.com', '.openai.com', '.oaiusercontent.com']
const SAFE_IMAGE_MIME_TYPES = new Set([
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
])

export type { ImageAttachmentBlobRecord, ImageAttachmentRepository } from '../shared/imageAttachmentRepository'

export interface ImageAttachmentService {
  captureReplyImages(input: {
    chatId: string
    messageId: string
    images: ReplyImageSource[]
  }): Promise<MessageImageAttachment[]>
  deleteByIds(ids: string[]): Promise<void>
}

export function createImageAttachmentService(deps: {
  fetchImage(url: string, init: RequestInit): Promise<Response>
  repository: ImageAttachmentRepository
  newId(): string
  now(): number
  maxImageBytes?: number
}): ImageAttachmentService {
  const maxImageBytes = deps.maxImageBytes ?? MAX_IMAGE_BYTES

  return {
    async captureReplyImages(input): Promise<MessageImageAttachment[]> {
      const uniqueImages = deduplicateImages(input.images)
      const attachments: MessageImageAttachment[] = []
      for (const [index, image] of uniqueImages.entries()) {
        attachments.push(await captureImage(image, index))
      }
      return attachments

      async function captureImage(image: ReplyImageSource, index: number): Promise<MessageImageAttachment> {
        const id = deps.newId()
        const shared = {
          id,
          type: 'image' as const,
          ...normalizeImagePresentation(image),
        }

        try {
          // Bytes read inside the site page (blob: sources), or a ChatGPT https source downloaded here.
          const { blob, mimeType } = image.dataUrl ? decodeImageDataUrl(image.dataUrl) : await downloadSiteImage(image.sourceUrl)
          if (blob.size > maxImageBytes) throw new Error('Image exceeds the 25 MB limit')
          const normalizedBlob = blob.type === mimeType ? blob : blob.slice(0, blob.size, mimeType)
          const fileName = `${image.dataUrl ? 'reply' : imageDownloadSite(image.sourceUrl)}-image-${index + 1}.${extensionForMimeType(mimeType)}`
          const record: ImageAttachmentBlobRecord = {
            id,
            chatId: input.chatId,
            messageId: input.messageId,
            blob: normalizedBlob,
            mimeType,
            size: normalizedBlob.size,
            fileName,
            createdAt: deps.now(),
          }
          await deps.repository.put(record)

          return {
            ...shared,
            status: 'ready',
            mimeType,
            size: normalizedBlob.size,
            fileName,
          }
        } catch (error) {
          return {
            ...shared,
            status: 'error',
            error: safeCaptureError(error),
          }
        }
      }
    },
    deleteByIds(ids): Promise<void> {
      return deps.repository.deleteByIds(ids)
    },
  }

  async function downloadSiteImage(value: string): Promise<{ blob: Blob; mimeType: string }> {
    const sourceUrl = requireDownloadableImageUrl(value)
    const response = await deps.fetchImage(sourceUrl, {
      method: 'GET',
      credentials: 'include',
      redirect: 'follow',
      cache: 'no-store',
    })
    if (!response.ok) throw new Error(`Image download failed (HTTP ${response.status})`)
    if (response.url) requireSafeRedirect(sourceUrl, response.url)

    const mimeType = normalizeImageMimeType(response.headers.get('content-type'))
    if (!mimeType) throw new Error('Remote content is not an image')
    const declaredSize = readContentLength(response.headers.get('content-length'))
    if (declaredSize !== undefined && declaredSize > maxImageBytes) throw new Error('Image exceeds the 25 MB limit')
    return { blob: await response.blob(), mimeType }
  }
}

// A data URL from the site page is untrusted input: only the raster types in SAFE_IMAGE_MIME_TYPES (no SVG), base64.
function decodeImageDataUrl(value: string): { blob: Blob; mimeType: string } {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/.exec(value)
  const mimeType = normalizeImageMimeType(match?.[1] ?? null)
  if (!match || !mimeType) throw new Error('Remote content is not an image')
  const binary = atob(match[2])
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return { blob: new Blob([bytes], { type: mimeType }), mimeType }
}

function deduplicateImages(images: ReplyImageSource[]): ReplyImageSource[] {
  const byUrl = new Map<string, ReplyImageSource>()
  for (const image of images) {
    const sourceUrl = image.sourceUrl.trim()
    if (!sourceUrl) continue
    const current = byUrl.get(sourceUrl)
    byUrl.set(sourceUrl, {
      sourceUrl,
      dataUrl: current?.dataUrl ?? image.dataUrl,
      alt: current?.alt ?? image.alt,
      width: current?.width ?? image.width,
      height: current?.height ?? image.height,
    })
  }
  return [...byUrl.values()]
}

// Which member site may have this image URL downloaded (with the browser's cookies): ChatGPT for its own pages, Gemini
// for Google's user-content CDN (its chart images, which its page cannot read: no CORS).
export function imageDownloadSite(value: string): 'chatgpt' | 'gemini' | undefined {
  const url = parseHttpsUrl(value)
  if (!url) return undefined
  if (CHATGPT_IMAGE_SOURCE_HOSTS.has(url.hostname)) return 'chatgpt'
  if (url.hostname.endsWith('.googleusercontent.com')) return 'gemini'
  return undefined
}

function requireDownloadableImageUrl(value: string): string {
  if (!imageDownloadSite(value)) throw new Error('Unsupported image source')
  return value
}

// A redirect stays with the source's own image hosts.
function requireSafeRedirect(source: string, value: string): void {
  const url = parseHttpsUrl(value)
  const allowed = imageDownloadSite(source) === 'gemini' ? url?.hostname.endsWith('.googleusercontent.com') : url && isOpenAiImageHost(url.hostname)
  if (!allowed) throw new Error('Image redirected to an untrusted site')
}

function parseHttpsUrl(value: string): URL | undefined {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url : undefined
  } catch {
    return undefined
  }
}

function isOpenAiImageHost(hostname: string): boolean {
  return CHATGPT_IMAGE_SOURCE_HOSTS.has(hostname) ||
    hostname === 'openai.com' ||
    hostname === 'oaiusercontent.com' ||
    OPENAI_IMAGE_HOST_SUFFIXES.some(suffix => hostname.endsWith(suffix))
}

function normalizeImageMimeType(value: string | null): string | undefined {
  const mimeType = value?.split(';')[0]?.trim().toLowerCase()
  return mimeType && SAFE_IMAGE_MIME_TYPES.has(mimeType) ? mimeType : undefined
}

function readContentLength(value: string | null): number | undefined {
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

function extensionForMimeType(mimeType: string): string {
  if (mimeType === 'image/jpeg') return 'jpg'
  if (mimeType === 'image/webp') return 'webp'
  if (mimeType === 'image/gif') return 'gif'
  if (mimeType === 'image/avif') return 'avif'
  return 'png'
}

function normalizeImagePresentation(image: ReplyImageSource): Pick<MessageImageAttachment, 'alt' | 'width' | 'height'> {
  const alt = image.alt?.trim().slice(0, 500)
  const width = normalizeDimension(image.width)
  const height = normalizeDimension(image.height)
  return {
    ...(alt ? { alt } : {}),
    ...(width ? { width } : {}),
    ...(height ? { height } : {}),
  }
}

function normalizeDimension(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 20_000 ? value : undefined
}

function safeCaptureError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (message === 'Unsupported image source' || message === 'Remote content is not an image') return message
  if (message.includes('25 MB')) return 'Image exceeds the 25 MB limit'
  if (message.includes('HTTP')) return message
  if (/redirect/i.test(message)) return message
  return 'Failed to fetch image'
}
