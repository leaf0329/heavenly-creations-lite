import { FlatCompat } from '@eslint/eslintrc'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const directory = path.dirname(fileURLToPath(import.meta.url))
const compat = new FlatCompat({ baseDirectory: directory })

const config = [
  { ignores: ['.next/**', 'node_modules/**', 'coverage/**', 'data/**', 'vendor/**'] },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      '@typescript-eslint/triple-slash-reference': 'off',
    },
  },
]

export default config
