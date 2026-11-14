// [role="button"]: DeepSeek's code-card Copy/Download controls are divs. Screen-reader-only labels (Grok's "Grok" turn
// heading, "ChatGPT said:") are page chrome, not reply text.
const SKIP_SELECTORS = 'button, [role="button"], svg, style, script, textarea, mat-icon, .sr-only, .visually-hidden, .cdk-visually-hidden'
// Formulas: MathML with a TeX annotation (KaTeX on most sites), or Gemini's wrapper carrying the TeX in data-math.
const MATH_SELECTOR = 'math, [data-math]:not([data-math=""])'
// One code element per card: <pre>, or ChatGPT's CodeMirror view (no <pre>, one div per line).
const CODE_SELECTOR = 'pre, .cm-content'
const PROSE_SELECTOR = 'p, li, table, blockquote, h1, h2, h3, h4, h5, h6'
// The most a code card's header may say besides its (skipped) buttons: a language label such as "Python" or "c++".
const LANGUAGE_LABEL = /^[A-Za-z][\w#+.-]{0,19}$/

// A file a reply offers (ChatGPT's file card names it only in its button label, "Open preview of data.csv").
const FILE_NAME = /([^\s/\\"'<>]+\.(?:csv|tsv|xlsx?|docx?|pptx?|pdf|txt|md|json|xml|ya?ml|py|ipynb|js|ts|html|css|sql|zip|png|jpe?g|gif|webp|mp3|mp4|wav))\s*$/i
// Files already named in the reply being read (a card has several buttons naming the same file).
let namedFiles = new Set<string>()

export function extractMarkdownFromDom(node: Node): string {
  namedFiles = new Set()
  return normalizeMarkdown(block(node))
}

// What a reply shows but Markdown cannot carry gets a line naming it: an offered file, a video. Both stay on the site.
// undefined: not such an element.
function mediaLine(element: Element): string | undefined {
  if (element.matches('video')) {
    const source = element.getAttribute('src') || element.querySelector('source')?.getAttribute('src') || ''
    return source.startsWith('https://') ? `\n\n🎬 [video](${source})\n\n` : '\n\n🎬 video\n\n'
  }
  if (!element.matches('button, [role="button"]')) return undefined
  const name = FILE_NAME.exec(element.getAttribute('aria-label') ?? '')?.[1]
  if (!name || namedFiles.has(name)) return ''
  namedFiles.add(name)
  return `\n\n📎 ${name}\n\n`
}

function block(node: Node, depth = 0): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent || ''
  if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) return [...node.childNodes].map(child => block(child, depth)).join('')
  if (node.nodeType !== Node.ELEMENT_NODE) return ''

  const element = node as Element
  const tag = element.tagName.toLowerCase()
  if (element.getAttribute('aria-hidden') === 'true') return ''
  const line = mediaLine(element)
  if (line !== undefined) return line
  if (element.matches(SKIP_SELECTORS)) return ''
  if (element.matches(MATH_SELECTOR)) return mathMarkdown(element)

  const card = codeCard(element)
  if (card !== undefined) return card

  if (/^h[1-6]$/.test(tag)) {
    const level = Number(tag.slice(1))
    return `\n${'#'.repeat(level)} ${inlineChildren(element).replace(/\s+/g, ' ').trim()}\n`
  }

  if (tag === 'p') return `\n${inlineChildren(element).trim()}\n`
  // A link outside a paragraph (ChatGPT's source cards are divs) keeps its URL too.
  if (tag === 'a') return inline(element)

  if (tag === 'blockquote') {
    return `\n${normalizeMarkdown([...element.childNodes].map(child => block(child, depth)).join(''))
      .split('\n')
      .map(line => `> ${line}`)
      .join('\n')}\n`
  }

  if (tag === 'ul') {
    return `\n${[...element.children].map(item => `${'  '.repeat(depth)}- ${listItemText(item, depth)}`).join('\n')}\n`
  }

  if (tag === 'ol') {
    return `\n${[...element.children].map((item, index) => `${'  '.repeat(depth)}${index + 1}. ${listItemText(item, depth)}`).join('\n')}\n`
  }

  if (tag === 'table') return tableMarkdown(element)

  return [...element.childNodes].map(child => block(child, depth)).join('')
}

function inline(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent || ''
  if (node.nodeType !== Node.ELEMENT_NODE) return ''

  const element = node as Element
  const tag = element.tagName.toLowerCase()
  if (element.getAttribute('aria-hidden') === 'true') return ''
  const line = mediaLine(element)
  if (line !== undefined) return line
  if (element.matches(SKIP_SELECTORS)) return ''
  if (element.matches(MATH_SELECTOR)) return mathMarkdown(element)

  const content = inlineChildren(element)
  if (tag === 'strong' || tag === 'b') return emphasis(content, '**')
  if (tag === 'em' || tag === 'i') return emphasis(content, '*')
  if (tag === 'code') {
    // Code holding backticks needs a longer delimiter run (and spaces) or its first backtick would close the span.
    const longest = Math.max(0, ...[...content.matchAll(/`+/g)].map(run => run[0].length))
    return longest ? `${'`'.repeat(longest + 1)} ${content} ${'`'.repeat(longest + 1)}` : `\`${content}\``
  }
  if (tag === 'a') {
    const href = element.getAttribute('href')
    if (!href) return content
    // A web citation chip: its label is only a number (DeepSeek shows "-3" with an invisible spacer).
    const citation = /^\d{1,3}$/.exec(element.getAttribute('aria-label')?.trim() ?? '')?.[0] ?? /^-?(\d{1,3})$/.exec(content.trim())?.[1]
    return citation ? ` [[${citation}]](${href})` : `[${content}](${href})`
  }
  if (tag === 'br') return '\n'

  return content
}

// A formula comes once, as its TeX source. Sites render it with KaTeX: the visual copy is aria-hidden, and the MathML
// symbols alone run together ("239" for \frac{2}{3}\sqrt{9}), followed by the TeX annotation.
function mathMarkdown(element: Element): string {
  const tex = (element.getAttribute('data-math') ?? element.querySelector('annotation[encoding="application/x-tex"]')?.textContent)?.trim()
  if (!tex) return element.textContent || ''
  return element.getAttribute('display') === 'block' || element.classList.contains('math-block') ? `\n\n$$${tex}$$\n\n` : `$${tex}$`
}

// A site's code card (header with the language and copy controls, around one code element) becomes one fenced block.
// undefined: this element is not a card; its children are read as usual.
function codeCard(element: Element): string | undefined {
  const codes = element.matches(CODE_SELECTOR) ? [element] : [...element.querySelectorAll(CODE_SELECTOR)]
  if (codes.length !== 1) return undefined
  const [code] = codes
  if ([...element.querySelectorAll(PROSE_SELECTOR)].some(prose => !code.contains(prose))) return undefined
  const label = textOutside(element, code).trim()
  if (label && !LANGUAGE_LABEL.test(label)) return undefined

  const language = (code.getAttribute('data-language')
    ?? (code.matches('code') ? code : code.querySelector('code'))?.className.match(/language-([\w#+.-]+)/)?.[1]
    ?? label).toLowerCase()
  const text = (code.matches('.cm-content')
    ? [...code.querySelectorAll('.cm-line')].map(line => line.textContent ?? '').join('\n')
    : (code.querySelector('code') ?? code).textContent ?? '').replace(/^\n+|\s+$/g, '')
  // A fence longer than any backtick run inside, so code that shows ``` stays inside the block.
  const fence = '`'.repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map(run => run[0].length + 1)))
  return `\n\n${fence}${language}\n${text}\n${fence}\n\n`
}

function textOutside(root: Element, inner: Element): string {
  const visit = (node: Node): string => {
    if (node === inner) return ''
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || ''
    if (node.nodeType !== Node.ELEMENT_NODE) return ''
    const element = node as Element
    if (element.matches(SKIP_SELECTORS) || element.getAttribute('aria-hidden') === 'true') return ''
    return [...element.childNodes].map(visit).join('')
  }
  return visit(root)
}

// Spaces stay outside the markers: "**Tải xuống file **CSV" is not bold in Markdown, "**Tải xuống file** CSV" is.
function emphasis(content: string, marker: string): string {
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(content)!
  return match[2] ? `${match[1]}${marker}${match[2]}${marker}${match[3]}` : content
}

function inlineChildren(element: Element): string {
  return [...element.childNodes].map(inline).join('')
}

function listItemText(element: Element, depth: number): string {
  const inlinePart = [...element.childNodes]
    .filter(child => child.nodeType !== Node.ELEMENT_NODE || !['UL', 'OL'].includes((child as Element).tagName))
    .map(inline)
    .join('')
    .trim()
  const nestedPart = [...element.children]
    .filter(child => child.tagName === 'UL' || child.tagName === 'OL')
    .map(child => block(child, depth + 1).trimEnd())
    .join('\n')
  return [inlinePart, nestedPart].filter(Boolean).join('\n')
}

function tableMarkdown(element: Element): string {
  // Cells keep their inline Markdown (bold, code, formulas once); a literal | would end the cell.
  const rows = [...element.querySelectorAll('tr')].map(row => [...row.children].map(cell => inlineChildren(cell).replace(/\s+/g, ' ').trim().replace(/\|/g, '\\|')))
  if (rows.length === 0) return ''

  const separator = rows[0].map(() => ' --- ').join('|')
  return `\n${[rows[0].join(' | '), separator, ...rows.slice(1).map(cells => cells.join(' | '))].join('\n')}\n`
}

function normalizeMarkdown(value: string): string {
  return value
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
