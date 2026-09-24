import type { AnchorRecord } from '@/lib/data/types'
import { TrustNote } from '@/components/ui/primitives'

/** Every verdict surface carries this. It must be truthful about what actually ran. */
export function SourceNote({ anchor, verifier, className }: { anchor: AnchorRecord | null; verifier: string; className?: string }) {
  return (
    <div className={className}>
      <TrustNote label="WASM">
        Verified in this browser by {verifier} compiled to WebAssembly: the same Rust code as the CLI and the attestor. The Halo2 proof and
        the holder’s signature were checked here; the proof was not sent anywhere.
      </TrustNote>
      {anchor?.network === 'demo' && (
        <TrustNote label="DEMO ANCHOR" tone="strong" className="mt-3">
          This proof is anchored to the published demo ledger, not to Zcash mainnet: the notes are real Ironwood notes under a real key and the
          proof is real, but the commitment tree and nullifier set are ours. Mainnet anchors are rebuilt from public chain data by pof-anchor.
        </TrustNote>
      )}
    </div>
  )
}
