import { build } from 'esbuild'
import { mkdirSync } from 'fs'
import { execSync } from 'child_process'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

mkdirSync(resolve(__dirname, '../dist'), { recursive: true })

await build({
  entryPoints: [resolve(__dirname, '../src/index.js')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: resolve(__dirname, '../dist/index.mjs'),
  external: [],
  banner: {
    js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
  },
})

execSync('cd dist && zip -r function.zip index.mjs', { cwd: resolve(__dirname, '..') })
console.log('Built: dist/function.zip')
