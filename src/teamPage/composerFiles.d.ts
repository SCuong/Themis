// Globals shared with the hand-written composer-files.js, which loads before team.js.
import type { GroupMessage } from '../group/types'

declare global {
  // eslint-disable-next-line no-var
  var themisComposerFiles: {
    list(): unknown[]
    clear(): void
    messageFiles(message: GroupMessage): HTMLElement | undefined
  } | undefined
  // eslint-disable-next-line no-var
  var ThemisMarkdownIt: unknown
}

export {}
