import type { SourceKind } from '@/lib/data/types'
import { TrustNote } from '@/components/ui/primitives'

/** Every verdict surface carries this. It must be truthful about what actually ran. */
export function SourceNote({ kind, className }: { kind: SourceKind; className?: string }) {
  if (kind === 'wasm') {
    return (
      <TrustNote label="WASM" className={className}>
        Verified in this browser by pof-verify compiled to WebAssembly: the same Rust code as the CLI. The proof was not sent anywhere.
      </TrustNote>
    )
  }
  return (
    <TrustNote label="FIXTURE" tone="strong" className={className}>
      This verdict did not come from the real verifier. In your browser, the file was parsed, its blake2b checksum recomputed, and its expiry
      and audience checked. Revocation, the anchor and the Halo2 proof were compared byte for byte against committed test vectors. No
      zero-knowledge cryptography ran. The WASM build of pof-verify replaces this module without changing the page.
    </TrustNote>
  )
}
