// See: https://rollupjs.org/introduction/

import commonjs from '@rollup/plugin-commonjs'
import { nodeResolve } from '@rollup/plugin-node-resolve'
import json from '@rollup/plugin-json'

const config = {
  input: 'src/index.js',
  output: {
    esModule: true,
    dir: './dist',
    format: 'es',
    sourcemap: true
  },
  // Node built-ins loaded lazily by dependencies (e.g. undici) must stay external.
  external: ['node:sqlite'],
  plugins: [commonjs(), json(), nodeResolve({ preferBuiltins: true })],
  onwarn(warning, warn) {
    // Ignore circular dependencies inside third-party packages (e.g. @actions/core).
    if (
      warning.code === 'CIRCULAR_DEPENDENCY' &&
      warning.ids?.every((id) => id.includes('node_modules'))
    ) {
      return
    }
    // TypeScript-emitted helpers in ESM deps use `this && this.__awaiter`,
    // which safely falls back when `this` is undefined.
    if (
      warning.code === 'THIS_IS_UNDEFINED' &&
      warning.id?.includes('node_modules')
    ) {
      return
    }
    warn(warning)
  }
}

export default config
