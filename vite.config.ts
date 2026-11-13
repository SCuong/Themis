import { defineConfig, type Plugin } from 'vite'
import { build as buildWithEsbuild } from 'esbuild'
import { join, resolve } from 'path'
import { cpSync, readFileSync, readdirSync } from 'fs'

// Hand-written Themis files that ship as they are (not bundled), copied from the repo root into dist/.
export const STATIC_FILES = [
  'manifest.json',
  'team.html',
  'team.css',
  'team-refinements.css',
  'team-ui.js',
  'composer-files.js',
  'localization.js',
  'profile-avatars.js',
  'assets/icons',
  'assets/profile-atlas.webp',
  'vendor',
  'LICENSE',
  'NOTICE',
]

// Hand-written modules the bundles import but that ship as their own files at the extension root.
// Source imports them by their real path; the output points at the copy in dist/ from each chunk.
const UNBUNDLED_MODULES = ['localization.js', 'team-ui.js', 'profile-avatars.js']
const UNBUNDLED_PREFIX = 'themis-root:'

function unbundledModules(): Plugin {
  return {
    name: 'unbundled-root-modules',
    enforce: 'pre',
    resolveId(source) {
      const file = source.split('/').pop() ?? ''
      if (source.startsWith('.') && UNBUNDLED_MODULES.includes(file)) return { id: UNBUNDLED_PREFIX + file, external: true }
      return undefined
    },
    generateBundle(_options, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue
        const toRoot = chunk.fileName.includes('/') ? '../'.repeat(chunk.fileName.split('/').length - 1) : './'
        chunk.code = chunk.code.replaceAll(UNBUNDLED_PREFIX, toRoot)
      }
    },
  }
}

export function hasTopLevelStaticImport(source: string): boolean {
  return /^\s*import(?:[\s{*"']|\w)/m.test(source)
}

export function createViteBuildHardeningOptions(mode: string): { minify: false | 'esbuild'; sourcemap: false } {
  return {
    minify: mode === 'development' ? false : 'esbuild',
    sourcemap: false,
  }
}

export function createEsbuildScriptHardeningOptions(mode: string): { minify: boolean; sourcemap: false; legalComments: 'none' } {
  return {
    minify: mode !== 'development',
    sourcemap: false,
    legalComments: 'none',
  }
}

function mustBeSelfContainedScript(fileName: string): boolean {
  return /(?:content|PageWorldBridge)\.js$/.test(fileName)
}

export function assertCompliantReleaseScript(fileName: string, source: string): void {
  if (mustBeSelfContainedScript(fileName) && hasTopLevelStaticImport(source)) {
    throw new Error(`${fileName} must be self-contained because Chrome content_scripts are not ES modules`)
  }
  if (/(?:sourceMappingURL|sourceURL)=/.test(source)) {
    throw new Error(`${fileName} must not expose a source map reference in release builds`)
  }
  if (/\beval\s*\(|\b(?:new\s+)?Function\s*\(/.test(source)) {
    throw new Error(`${fileName} must not use dynamic code execution in release builds`)
  }
}

export function collectJavaScriptFiles(directory: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectJavaScriptFiles(entryPath))
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(entryPath)
    }
  }
  return files
}

export default defineConfig(({ mode }) => ({
  publicDir: false,
  define: {
    __OPENTEAM_DEV__: JSON.stringify(mode === 'development'),
  },
  plugins: [
    unbundledModules(),
    {
      name: 'safe-lodash-global-root',
      transform(source, id) {
        if (!id.endsWith('/lodash-es/_root.js')) return undefined
        return source.replace("Function('return this')()", 'globalThis')
      },
    },
    {
      name: 'extension-files',
      apply: 'build',
      async closeBundle() {
        const esbuildHardeningOptions = createEsbuildScriptHardeningOptions(mode)

        await buildWithEsbuild({
          entryPoints: [resolve(__dirname, 'src/content/index.ts')],
          outfile: resolve(__dirname, 'dist/content.js'),
          bundle: true,
          format: 'iife',
          platform: 'browser',
          target: 'chrome114',
          define: {
            __OPENTEAM_DEV__: JSON.stringify(mode === 'development'),
          },
          ...esbuildHardeningOptions,
        })

        // Only the bundles are checked; vendor/ is a third-party build shipped unchanged.
        for (const scriptPath of collectJavaScriptFiles('dist')) {
          assertCompliantReleaseScript(scriptPath, readFileSync(scriptPath, 'utf8'))
        }
        for (const file of STATIC_FILES) cpSync(file, join('dist', file), { recursive: true })
      }
    }
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    ...createViteBuildHardeningOptions(mode),
    rollupOptions: {
      input: {
        background: resolve(__dirname, 'src/background/index.ts'),
        team: resolve(__dirname, 'src/teamPage/index.ts')
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'assets/[name].js',
        hoistTransitiveImports: false,
      }
    }
  },
}))
