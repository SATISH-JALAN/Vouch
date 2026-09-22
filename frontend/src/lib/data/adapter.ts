// The one switch between fixtures and the real verifier.
// Set NEXT_PUBLIC_POF_WASM=1 once public/wasm/pof_wasm.js is built. Every verdict surface
// reads `source.kind` and labels itself accordingly — never hardcode that label.

import { fixtures } from './fixtures.ts'
import { live } from './live.ts'

export const hasWasm = process.env.NEXT_PUBLIC_POF_WASM === '1'

export const source = hasWasm ? live : fixtures
