import type { ReactNode } from 'react'
import { ANCHOR, DEMO_AUDIENCE, ED25519_PROGRAM } from './data/chain'
import { formatInt } from './format'
import { LINKS } from './site'

export interface DocSection {
  id: string
  title: string
  body: ReactNode
}

export interface Doc {
  slug: string
  eyebrow: string
  title: string
  lede: string
  sections: DocSection[]
}

const Code = ({ children }: { children: string }) => (
  <pre className="t-data my-6 overflow-x-auto rounded-chip border border-border bg-bone-2 p-5 text-ink" data-lenis-prevent="">
    {children}
  </pre>
)

const C = ({ children }: { children: ReactNode }) => <code className="rounded-[2px] bg-bone-2 px-1 font-mono text-[0.88em] text-ink">{children}</code>

const Table = ({ head, rows }: { head: string[]; rows: ReactNode[][] }) => (
  <div className="my-6 overflow-x-auto">
    <table className="t-data w-full border-collapse text-left">
      <thead>
        <tr className="border-b border-ink">
          {head.map((h) => (
            <th key={h} className="t-eyebrow h-10 pr-6 font-medium text-ink-3">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-b border-border">
            {r.map((c, j) => (
              <td key={j} className={j === 0 ? 'whitespace-nowrap py-[10px] pr-6 align-top text-ink' : 'py-[10px] pr-6 align-top text-ink-2'}>
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
)

const format: Doc = {
  slug: 'format',
  eyebrow: 'SPECIFICATION · VERSION 1 · DRAFT',
  title: 'The proof format',
  lede: 'A .pof file carries one claim, for one audience, anchored to one block, with an expiry and a revocation tag. This page is written so that someone else can implement a verifier against it.',
  sections: [
    {
      id: 'principles',
      title: 'Principles',
      body: (
        <>
          <p>
            <strong>The proof is a file, not an API call.</strong> Every component talks through this artifact. That gives offline verification, a
            testable boundary, and a format that can outlive any one implementation.
          </p>
          <p>
            <strong>No optional semantics.</strong> Every field is always present. Optionality in a security format is how verifiers end up
            disagreeing about what was proven.
          </p>
          <p>
            <strong>The verifier never trusts a field it can derive.</strong> The envelope says what to check, never what is true. An anchor root
            in the envelope is still checked against the chain.
          </p>
        </>
      ),
    },
    {
      id: 'file',
      title: 'The file',
      body: (
        <>
          <p>
            Binary, then base64url (RFC 4648 §5, no padding) wherever it travels as text or inside a URL. The file extension is <C>.pof</C>.
          </p>
          <Code>{` magic      "POF1"                 4 bytes   50 4F 46 31
 version    u16, little-endian     2 bytes   01 00
 body       postcard(Envelope)     variable
 checksum   blake2b-256(body)      32 bytes`}</Code>
          <p>
            The magic bytes let a verifier reject garbage instantly with a useful error instead of a decode panic. The checksum makes a truncated
            paste distinguishable from a forgery. A forger re-seals the checksum; a clipboard does not. Those are different messages in the UI.
          </p>
        </>
      ),
    },
    {
      id: 'envelope',
      title: 'The envelope',
      body: (
        <>
          <Code>{`pub struct Envelope {
    pub version:    u16,
    pub claim:      Claim,
    pub audience:   [u8; 32],   // blake2b-256 of the verifier identifier
    pub anchor:     Anchor,     // { height: u32, root: [u8; 32] }
    pub issued_at:  u64,        // unix seconds
    pub expires_at: u64,        // unix seconds, absolute
    pub revocation: [u8; 16],   // opaque tag
    pub evidence:   Evidence,   // public inputs + Halo2 proof bytes
}`}</Code>
          <Table
            head={['Field', 'Rule']}
            rows={[
              ['version', 'Bump on any wire change. Refuse unknown majors; warn on unknown minors.'],
              ['claim', 'Exactly one statement. Never a list. Two facts are two proofs.'],
              ['audience', 'A hash, not a name. The verifier proves it is the audience by matching; nobody else learns who it was for.'],
              ['anchor', 'Height and root together. Height alone is forgeable against a reorg; a root alone has no time.'],
              ['expires_at', 'Absolute, not a duration. A duration requires agreeing on issue time.'],
              ['revocation', 'Opaque. The verifier checks it against a signed, append-only list.'],
              ['evidence', 'The only variable-length field.'],
            ]}
          />
        </>
      ),
    },
    {
      id: 'claims',
      title: 'Claims',
      body: (
        <>
          <Code>{`pub enum Claim {
    HoldsAtLeast         { zatoshi: u64 },                   // tag 0
    HoldsExactly         { zatoshi: u64 },                   // tag 1
    ReceivedPayment      { txid: [u8; 32], zatoshi: u64 },   // tag 2
    ReceivedAtLeastSince { zatoshi: u64, from_height: u32 }, // tag 3
}`}</Code>
          <p>
            Amounts are zatoshi. 1 ZEC = 100,000,000 zatoshi, so 500 ZEC is <C>50000000000</C>. Display always uses exactly eight decimals, or
            rounds explicitly for prose. No claim variant carries anything the verifier does not need.
          </p>
        </>
      ),
    },
    {
      id: 'verdict',
      title: 'Verification and verdicts',
      body: (
        <>
          <p>Six checks, cheapest first. The verifier stops at the first failure and never runs cryptography on an artifact that failed a cheap check.</p>
          <Table
            head={['#', 'Check', 'Failure']}
            rows={[
              ['1', 'Format, version and checksum parse', <C key="1">Malformed</C>],
              ['2', 'Now is before expires_at', <C key="2">Expired</C>],
              ['3', 'Revocation tag is not on the list', <C key="3">Revoked</C>],
              ['4', 'blake2b(identifier) equals audience', <C key="4">WrongAudience</C>],
              ['5', 'The root exists at that height on chain', <C key="5">AnchorNotFound</C>],
              ['6', 'The proof verifies against the public inputs', <C key="6">ProofInvalid</C>],
            ]}
          />
          <Code>{`pub enum Verdict {
    Valid { claim: Claim, anchor_height: u32 },
    Expired { at: u64 },
    Revoked,
    WrongAudience,
    AnchorNotFound,
    ProofInvalid,
    Malformed(String),
}`}</Code>
          <p>
            Return a typed verdict, never a bool. <C>ProofInvalid</C> says exactly that and not which constraint failed; verbose failure detail
            in a security tool is a debugging aid for an attacker.
          </p>
        </>
      ),
    },
    {
      id: 'example',
      title: 'An example',
      body: (
        <>
          <p>
            The test vectors on <a className="link-draw text-ink" href="/verify">/verify</a> anchor to Zcash mainnet block{' '}
            {formatInt(ANCHOR.height)} (block hash <C>{ANCHOR.blockHash.slice(0, 16)}…</C>). Their audience is the hash of{' '}
            <C>{DEMO_AUDIENCE.id}</C>. The tree root and the evidence are fixture material until the prover emits real ones.
          </p>
          <Code>{`{
  "version": 1,
  "claim": { "kind": "HoldsAtLeast", "zatoshi": 50000000000 },
  "audience": "blake2b-256(\\"${DEMO_AUDIENCE.id}\\")",
  "anchor": { "height": ${ANCHOR.height}, "root": "…32 bytes…" },
  "issued_at": 1790035200,
  "expires_at": 1790640000,
  "revocation": "…16 bytes…",
  "evidence": { "public_inputs": ["…4 × 32 bytes…"], "proof": "…2,208 bytes…" }
}`}</Code>
        </>
      ),
    },
  ],
}

const integration: Doc = {
  slug: 'integration',
  eyebrow: 'GUIDE',
  title: 'Accepting a proof',
  lede: 'One verifier implementation, three ways to run it. Pick the one that fits where your decision is made.',
  sections: [
    {
      id: 'request',
      title: '1 · Ask for a proof',
      body: (
        <>
          <p>
            Build a request at <a className="link-draw text-ink" href="/request">/request</a>. Choose the claim, the threshold, your identifier
            and an expiry. The whole request is encoded in the link, and nothing is stored. The holder opens it, sees exactly what you will learn,
            and runs the prover locally:
          </p>
          <Code>{`pof-prove --request <encoded> --wallet ~/.zallet/wallet.db --out proof.pof`}</Code>
        </>
      ),
    },
    {
      id: 'cli',
      title: '2 · Verify with the CLI',
      body: (
        <>
          <p>The reference. Prints the verdict and exits non-zero on anything but valid, so it can gate CI or a batch job.</p>
          <Code>{`pof-verify check proof.pof --audience ${DEMO_AUDIENCE.id}
# Valid · HoldsAtLeast 500.00000000 ZEC · anchor ${formatInt(ANCHOR.height)}
echo $?   # 0 valid · 1 invalid · 2 expired · 3 malformed`}</Code>
        </>
      ),
    },
    {
      id: 'wasm',
      title: '3 · Verify in the browser',
      body: (
        <>
          <p>
            <C>pof-wasm</C> wraps the same Rust crate with wasm-bindgen. Load it lazily, only on the route that verifies; the verifying key is
            large. The WASM boundary is pure: bytes in, verdict out. Chain data for the anchor check is passed in from JavaScript.
          </p>
          <Code>{`import init, { verify } from '/wasm/pof_wasm.js'

await init()
const result = JSON.parse(verify(bytes, '${DEMO_AUDIENCE.id}', BigInt(Date.now() / 1000 | 0)))
if (result.verdict.kind !== 'Valid') refuse(result.verdict)`}</Code>
        </>
      ),
    },
    {
      id: 'solana',
      title: '4 · Verify on Solana',
      body: (
        <>
          <p>
            A Solana program cannot verify a Halo2 proof over Pallas or read Zcash state. So <C>pof-attest</C> verifies off-chain and signs a
            domain-separated message, and <C>pof-gate</C> checks that signature through instruction introspection:
          </p>
          <Code>{`ix 0  ${ED25519_PROGRAM}   verify(attestor_pubkey, message, signature)
ix 1  pof-gate::submit_attestation(message)
        1. ix 0 targets the Ed25519 program
        2. its pubkey is on the allowlist
        3. its message equals the attestation passed in
        4. attestation age ≤ max_age_slots
        5. claim kind is recognised
        6. create ClaimReceipt PDA [b"receipt", hash]  ← replay protection`}</Code>
          <p>
            Consumers read the <C>ClaimReceipt</C> and call <C>mark_consumed</C> by CPI, so one proof funds one action. Read the{' '}
            <a className="link-draw text-ink" href="/docs/trust">trust model</a> before you rely on it.
          </p>
        </>
      ),
    },
  ],
}

const trust: Doc = {
  slug: 'trust',
  eyebrow: 'TRUST MODEL',
  title: 'Where trust still sits',
  lede: 'Vouch is trust-minimised, not trustless. This page says exactly where, before anyone has to ask.',
  sections: [
    {
      id: 'boundaries',
      title: 'The boundaries',
      body: (
        <Table
          head={['Party', 'Trusted for', 'Why that is acceptable']}
          rows={[
            ['Holder’s device', 'Keys and proving', 'Keys never leave it. Nothing is custodied, and there is no broadcast path.'],
            ['Zcash chain', 'The truth', 'A proof is checked against public chain data, not against our assertion.'],
            ['pof-verify', 'Checking', 'Open source. Anyone can run it and re-derive any verdict independently.'],
            ['pof-attest', 'Solana only', 'Signs verdicts for a chain that cannot read Zcash. Replaceable, allowlisted, and anyone can run one.'],
          ]}
        />
      ),
    },
    {
      id: 'attestor',
      title: 'The attestor, plainly',
      body: (
        <>
          <p>
            Verification of a Zcash fact by a Solana program goes through an open-source attestor. The program trusts the attestor allowlist and
            nothing else. If an allowlisted attestor lies, the program believes it. That is the honest cost of v1.
          </p>
          <p>
            It is mitigated by making the attestor boring: under two hundred lines, stateless, and trivially re-runnable against the same proof and
            public data. Multiple independent attestors reduce the trust further. A Zcash light client on Solana removes it; that is on the roadmap
            and is not a three-week job.
          </p>
        </>
      ),
    },
    {
      id: 'leak',
      title: 'What a leaked proof exposes',
      body: (
        <p>
          That some holder cleared a threshold at a block height, for a named audience, and nothing else: not the balance, not the notes, not the
          addresses. Proofs are bearer artifacts scoped to an audience; treat one like a signed document.
        </p>
      ),
    },
    {
      id: 'cannot',
      title: 'What this cannot do',
      body: (
        <ul className="list-none space-y-2">
          <li>— Prove where funds came from before they entered the shielded pool.</li>
          <li>— Prove a negative: that a holder has nothing elsewhere.</li>
          <li>— Stop a holder spending the funds right after proving. Proofs are point-in-time.</li>
          <li>— Make an institution accept a proof. That is a conversation, not a feature.</li>
        </ul>
      ),
    },
    {
      id: 'credits',
      title: 'What we built on',
      body: (
        <p>
          The holding proof depends on{' '}
          <a className="link-draw text-ink" href={LINKS.votingCircuits} target="_blank" rel="noreferrer">
            voting-circuits
          </a>{' '}
          (Valar Group) and{' '}
          <a className="link-draw text-ink" href={LINKS.zcashVoting} target="_blank" rel="noreferrer">
            zcash_voting
          </a>{' '}
          (Chainapsis), both MIT / Apache-2.0. We did not write those circuits. What we built is the envelope, the claim semantics, the verifier
          delivery and the Solana gate. No audit and no formal verification have been done. This is not production-ready.
        </p>
      ),
    },
  ],
}

export const DOCS: Doc[] = [format, integration, trust]

export const getDoc = (slug: string) => DOCS.find((d) => d.slug === slug)
