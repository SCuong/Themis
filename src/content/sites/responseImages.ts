import type { ReplyImageSource } from '../../group/types'

// Generated images in a reply, one entry per source. Sites now show them from blob: URLs (only readable inside the
// page; inlineReplyImages reads their bytes before the reply is reported), or from https.
export function extractResponseImages(node: Node, selector: string, accept: (image: HTMLImageElement) => boolean = () => true): ReplyImageSource[] {
  const scope = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement
  if (!scope) return []

  const bySourceUrl = new Map<string, ReplyImageSource>()
  for (const image of scope.querySelectorAll<HTMLImageElement>(selector)) {
    const sourceUrl = accept(image) ? normalizeImageUrl(image.currentSrc || image.src) : undefined
    if (!sourceUrl || bySourceUrl.has(sourceUrl)) continue
    const width = image.naturalWidth || image.width
    const height = image.naturalHeight || image.height
    bySourceUrl.set(sourceUrl, {
      sourceUrl,
      ...(image.alt.trim() ? { alt: image.alt.trim() } : {}),
      ...(width > 0 ? { width } : {}),
      ...(height > 0 ? { height } : {}),
    })
  }
  return [...bySourceUrl.values()]
}

function normalizeImageUrl(value: string): string | undefined {
  try {
    const url = new URL(value, location.href)
    return ['https:', 'blob:', 'data:'].includes(url.protocol) ? url.href : undefined
  } catch {
    return undefined
  }
}
