import { defineConfig } from 'vite'
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

// Imported by the team page bundle but kept as separate, readable files next to team.js.
const UNBUNDLED_MODULES: Record<string, string> = {
  '@themis/team-ui': './team-ui.js',
  '@themis/profile-avatars': './profile-avatars.js',
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
      external: Object.keys(UNBUNDLED_MODULES),
      output: {
        entryFileNames: '[name].js',
        paths: UNBUNDLED_MODULES,
      }
    }
  },
}))
