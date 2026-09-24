import type { ReactNode } from 'react'
import { DEMO_AUDIENCE, ED25519_PROGRAM, IRONWOOD_ACTIVATION_HEIGHT } from './data/chain'
import { formatInt } from './format'
import { LINKS } from './site'
import gateIdl from '../data/idl/pof_gate.json'
import creditIdl from '../data/idl/pof_credit.json'
import anchors from '../data/anchors.json'

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

const A = ({ href, children }: { href: string; children: ReactNode }) =>
  href.startsWith('http') ? (
    <a className="link-draw text-ink" href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ) : (
    <a className="link-draw text-ink" href={href}>
      {children}
    </a>
  )

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

const mainnet = anchors.filter((a) => a.network === 'mainnet').sort((a, b) => b.height - a.height)[0]
const REPO = LINKS.repo ?? 'https://github.com/SATISH-JALAN/Vouch'

const format: Doc = {
  slug: 'format',
  eyebrow: 'SPECIFICATION · VERSION 1',
  title: 'The proof format',
  lede: 'A .pof file carries one claim, for one audience, bound to one context, anchored to one block, with an expiry and a revocation tag. This page is written so that someone else can implement a verifier against it.',
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
            <strong>The verifier never trusts a field it can derive.</strong> The circuit’s round id, nullifier domain, threshold and both ledger
            roots are recomputed or looked up by the verifier; the file carries only the public inputs it cannot derive.
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
            Binary, then base64url (RFC 4648 §5, no padding) wherever it travels as text or inside a URL. The extension is <C>.pof</C>; a holding
            proof is 11,886 bytes.
          </p>
          <Code>{` magic      "POF1"                 4 bytes   50 4F 46 31
 version    u16, little-endian     2 bytes   01 00
 body       postcard(Body)         variable
 checksum   blake2b-256(body)      32 bytes`}</Code>
          <p>
            The magic bytes let a verifier reject garbage instantly. The checksum makes a truncated paste distinguishable from a forgery: a forger
            re-seals the checksum, a clipboard does not. The version lives in the header only; the body never repeats it.
          </p>
        </>
      ),
    },
    {
      id: 'body',
      title: 'The body',
      body: (
        <>
          <p>Postcard encoding: integers as LEB128 varints, fixed arrays as raw bytes, vectors as a varint length and elements, enums as a varint tag.</p>
          <Code>{`claim        enum Claim                      (varint tag + fields)
audience     [u8; 32]   blake2b-256("pof-audience:" ‖ lowercase(trim(id)))
binding      [u8; 32]   all zero, or e.g. the holder's Solana pubkey
anchor       { height: u32, nc_root: [u8; 32], nf_root: [u8; 32] }
issued_at    u64        unix seconds
expires_at   u64        unix seconds, absolute
revocation   [u8; 16]   blake2b("vouch-revoke-v1", secret)[..16]
evidence     { public_inputs: Vec<[u8; 32]>, proof: Vec<u8>, signature: [u8; 64] }`}</Code>
          <Table
            head={['Field', 'Rule']}
            rows={[
              ['claim', 'Exactly one statement. Never a list. Two facts are two proofs.'],
              ['audience', 'A hash, not a name. The verifier proves it is the audience by matching; nobody else learns who it was for.'],
              ['binding', 'Who may use the proof, for audiences that act on it (a Solana program). All zero when unbound.'],
              ['anchor', 'A height and both ledger roots at that height. The verifier accepts only roots in its authenticated anchor table.'],
              ['expires_at', 'Absolute, not a duration.'],
              ['revocation', 'Opaque. The holder revokes by publishing the secret; see the trust model.'],
              ['evidence', '9 public inputs, the Halo2 proof, and the spend-authorisation signature.'],
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
    HoldsAtLeast         { zatoshi: u64 },                   // tag 0 · v1
    HoldsExactly         { zatoshi: u64 },                   // tag 1 · reserved
    ReceivedPayment      { txid: [u8; 32], zatoshi: u64 },   // tag 2 · roadmap
    ReceivedAtLeastSince { zatoshi: u64, from_height: u32 }, // tag 3 · roadmap
}`}</Code>
          <p>
            v1 verifiers accept <C>HoldsAtLeast</C> only, and only for whole units of <strong>0.125 ZEC</strong> (12,500,000 zatoshi): the circuit
            counts value in those units. 500 ZEC is <C>50000000000</C> zatoshi, 4,000 units. <C>HoldsExactly</C> is deliberately not offered: a
            threshold reveals less.
          </p>
        </>
      ),
    },
    {
      id: 'binding',
      title: 'What binds the file to the proof',
      body: (
        <>
          <p>
            The <strong>statement</strong> is every body field except the evidence. Its personalised blake2b hash, with the top two bits cleared, is
            the circuit’s <C>vote_round_id</C>. The signed note’s rho, the governance commitment and the nullifier domain all bind to it, so a proof
            made for one statement does not verify for any other: change the audience, the expiry, the threshold, the binding or the anchor and
            the proof fails.
          </p>
          <Code>{`statement  = blake2b-256[personal "vouch-stmt-v1"](head)
round_id   = statement with bits 254..255 cleared, as a Pallas base element
dom        = Poseidon("governance authorization", round_id)
min_units  = claim.zatoshi / 12_500_000
message    = blake2b-256[personal "vouch-sig-v1"](statement ‖ public_inputs)
signature  = RedPallas SpendAuth over message, under rk`}</Code>
          <p>
            The signature is the holder’s spend authority. Someone who only has the holder’s viewing key can find the notes but cannot sign, so a
            viewing key is not enough to prove funds on someone’s behalf.
          </p>
        </>
      ),
    },
    {
      id: 'circuit',
      title: 'The circuit',
      body: (
        <>
          <p>
            The evidence is a Halo2 proof (IPA over Pasta, K = 12, no trusted setup) of the delegation circuit from{' '}
            <A href={LINKS.votingCircuits}>voting-circuits</A> 0.12.1, with one Vouch modification: a 15th public input, <C>min_ballots</C>, and the
            constraint <C>num_ballots − min_ballots ∈ [0, 2³⁰)</C>. It proves, for up to five of the holder’s notes:
          </p>
          <ul className="list-none space-y-2">
            <li>— each note is in the Ironwood note-commitment tree at <C>nc_root</C>;</li>
            <li>— each note is unspent: its real nullifier is not in the spent-nullifier IMT at <C>nf_root</C> (the nullifier stays private);</li>
            <li>— the prover holds the keys the notes are addressed to (<C>rk</C> is a re-randomisation of the notes’ <C>ak</C>);</li>
            <li>— the notes together hold at least <C>min_ballots</C> × 0.125 ZEC. The sum itself is committed, never revealed.</li>
          </ul>
          <p>
            Carried public inputs, in order: <C>nf_signed, rk, cmx_new, van_comm, gov_null_1..5</C>. Derived by the verifier: <C>vote_round_id</C>,{' '}
            <C>dom</C>, <C>nc_root</C>, <C>nf_imt_root</C>, <C>min_ballots</C>. The governance nullifiers are domain-separated per statement and
            unlinkable to the real nullifiers.
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
              ['1', 'Magic, version, checksum, body parse; HoldsAtLeast in whole units', <C key="1">Malformed</C>],
              ['2', 'Now is before expires_at', <C key="2">Expired</C>],
              ['3', 'No published secret hashes to the revocation tag', <C key="3">Revoked</C>],
              ['4', 'blake2b(identifier) equals audience', <C key="4">WrongAudience</C>],
              ['5', 'Both roots equal an authenticated anchor at that height', <C key="5">AnchorNotFound</C>],
              ['6', 'Signature under rk, then the Halo2 proof against the 15 public inputs', <C key="6">ProofInvalid</C>],
            ]}
          />
          <Code>{`pub enum Verdict {
    Valid { claim: Claim, anchor_height: u32 },
    Expired { at: u64 },
    Revoked,
    WrongAudience,
    AnchorNotFound,
    ProofInvalid { detail: String },
    Malformed { reason: String },
}`}</Code>
          <p>
            A typed verdict, never a bool. <C>ProofInvalid</C> says the evidence does not prove the statement and not which constraint failed;
            verbose failure detail in a security tool is a debugging aid for an attacker.
          </p>
        </>
      ),
    },
    {
      id: 'anchors',
      title: 'Anchors',
      body: (
        <>
          <p>
            An anchor is a finalised height and two roots: the Ironwood note-commitment tree root and the root of the indexed Merkle tree of every
            Ironwood nullifier revealed up to that height. <C>pof-anchor</C> rebuilds both from compact blocks since Ironwood activation (block{' '}
            {formatInt(IRONWOOD_ACTIVATION_HEIGHT)}), checks the first against lightwalletd’s own tree state, and publishes the pair.
          </p>
          {mainnet && (
            <Code>{`{
  "network": "mainnet",
  "height":  ${mainnet.height},
  "ncRoot":  "${mainnet.ncRoot}",
  "nfRoot":  "${mainnet.nfRoot}"
}`}</Code>
          )}
          <p>
            The table is served at <A href="/api/anchors">/api/anchors</A>. Anyone can re-derive every entry: <C>pof-anchor scan --to &lt;height&gt;</C>.
            The <C>demo</C> anchor belongs to the published demo ledger and is labelled as such wherever it is used.
          </p>
        </>
      ),
    },
    {
      id: 'example',
      title: 'Test vectors',
      body: (
        <p>
          Every preset on <A href="/verify">/verify</A> is a real proof written by <C>pof-prove demo fixtures</C> and committed in{' '}
          <A href={`${REPO}/tree/main/fixtures`}>fixtures/</A>, together with the verdict each must produce. The native verifier, the WASM
          verifier and the TypeScript codec are all checked against that one list in CI. Their audience is the hash of <C>{DEMO_AUDIENCE.id}</C>.
        </p>
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
            Build a request at <A href="/request">/request</A>: the threshold, your identifier, an expiry, and optionally a response deadline and a
            binding to the holder’s Solana account. The whole request is in the link; nothing is stored. The holder opens it at{' '}
            <C>/prove</C>, sees exactly what you will learn, and answers with the CLI:
          </p>
          <Code>{`pof-prove prove --request <encoded> --snapshot mainnet-${mainnet?.height ?? 3493000}.vsnp \\
                --seed-file ~/.vouch/seed.txt --out proof.pof`}</Code>
        </>
      ),
    },
    {
      id: 'cli',
      title: '2 · Verify with the CLI',
      body: (
        <>
          <p>The reference. Prints the verdict and exits non-zero on anything but valid, so it can gate CI or a batch job. It reads local files only.</p>
          <Code>{`curl -s ${'$'}SITE/api/anchors     > anchors.json
curl -s ${'$'}SITE/api/revocations > revocations.json
pof-verify check proof.pof --audience ${DEMO_AUDIENCE.id} \\
           --anchors anchors.json --revocations revocations.json
# Valid · 500.00000000 ZEC at least · anchor 3491040
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
            <C>pof-wasm</C> is the same Rust crate compiled with wasm-bindgen. Its verifying key is embedded (a native test proves it equals the key
            <C>keygen_vk</C> derives), so it warms up in about 300 ms and verifies in about 80 ms. The boundary is pure: bytes, the anchor table
            and the revocation list in; a verdict out.
          </p>
          <Code>{`import init, { verify } from '/wasm/pof_wasm.js'

await init()
const anchors = await (await fetch('/api/anchors')).text()
const revoked = JSON.stringify((await (await fetch('/api/revocations')).json()).secrets)
const now = BigInt(Math.floor(Date.now() / 1000))
const result = JSON.parse(verify(bytes, '${DEMO_AUDIENCE.id}', now, anchors, revoked))
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
            A Solana program cannot verify a Halo2 proof over Pallas or read Zcash state. So <C>pof-attest</C> runs the verifier and signs a
            domain-separated 139-byte message, and <C>pof-gate</C> checks that signature through instruction introspection:
          </p>
          <Code>{`message = "POF-ATTEST-v1" ‖ subject 32 ‖ beneficiary 32 ‖ audience 32 ‖ claim_kind 1
        ‖ claim_value u64 ‖ anchor_height u32 ‖ expires_at u64 ‖ verdict 1 ‖ slot u64

ix 0  ${ED25519_PROGRAM}   verify(attestor, message, signature)
ix 1  pof-gate::submit_attestation(subject, message)
        1. parse and domain-check; verdict = Valid; claim kind known
        2. slot within max_age_slots; expires_at in the future
        3. count distinct allowlisted keys that signed exactly this message in
           earlier Ed25519 instructions whose offsets all point into themselves
        4. count ≥ threshold (k of n)
        5. create ClaimReceipt PDA [b"receipt", subject]   ← one proof, one receipt`}</Code>
          <p>
            A consumer reads the receipt, checks the audience, the claim value, the expiry and that the signer is the <strong>beneficiary</strong>,
            then calls <C>mark_consumed</C> by CPI. <C>pof-credit</C> does exactly that.
          </p>
          <Table
            head={['Program', 'Id']}
            rows={[
              ['pof-gate', <C key="g">{gateIdl.address}</C>],
              ['pof-credit', <C key="c">{creditIdl.address}</C>],
            ]}
          />
          <p>
            Read the <A href="/docs/trust">trust model</A> before you rely on it, and <A href="/docs/attestor">run your own attestor</A>.
          </p>
        </>
      ),
    },
  ],
}

const prove: Doc = {
  slug: 'prove',
  eyebrow: 'HOLDER GUIDE',
  title: 'Answering a request',
  lede: 'From a link in your inbox to a proof in theirs, without your keys, your balance or your history leaving your machine.',
  sections: [
    {
      id: 'install',
      title: '1 · Install the prover',
      body: (
        <>
          <p>Rust 1.91 or newer. The prover is one binary; nothing else is installed.</p>
          <Code>{`cargo install --git ${REPO} pof-prove --locked
# or from source
git clone ${REPO} && cd Vouch/backend && cargo build --release -p pof-prove`}</Code>
        </>
      ),
    },
    {
      id: 'snapshot',
      title: '2 · Get the chain snapshot',
      body: (
        <>
          <p>
            The prover needs the public Ironwood data up to a published anchor: every note commitment and nullifier, and the encrypted outputs your
            wallet finds its notes in. Build it yourself from any lightwalletd:
          </p>
          <Code>{`cargo install --git ${REPO} pof-anchor --locked
pof-anchor scan --server https://zec.rocks:443 --to ${mainnet?.height ?? 3493000} --out snapshots/
# ✓ nc_root matches lightwalletd's Ironwood tree state at ${mainnet?.height ?? 3493000}`}</Code>
          <p>The anchor it prints must match the one published in the table, or verifiers will answer AnchorNotFound.</p>
        </>
      ),
    },
    {
      id: 'prove',
      title: '3 · Review, then prove',
      body: (
        <>
          <p>
            Open the request link at <C>/prove</C> to read what the verifier will and will not learn. Then run the command it shows. The prover
            prints the same sentence and asks before it does anything.
          </p>
          <Code>{`pof-prove prove --request <encoded> --snapshot snapshots/mainnet-${mainnet?.height ?? 3493000}.vsnp \\
                --seed-file ~/.vouch/seed.txt --out proof.pof

  ✓ account 0 on mainnet
  ✓ 565,704 Ironwood actions to block ${mainnet?.height ?? 3493000}
  ✓ 2 notes found
  ✓ anchor at block ${mainnet?.height ?? 3493000}
  ✓ 1 note used; balance not revealed
  wrote proof.pof (11,886 bytes). Nothing was broadcast.`}</Code>
          <p>
            The seed file holds a BIP 39 mnemonic or a hex seed. It is read by this process and nothing else; the prover links no network client
            at all (a test enforces it). It picks the fewest notes that clear the bar, up to five.
          </p>
        </>
      ),
    },
    {
      id: 'handover',
      title: '4 · Check it, hand it over',
      body: (
        <p>
          Drop proof.pof on <C>/prove</C> or <A href="/verify">/verify</A>: you see exactly the verdict the other side will see. Then send the file, or
          the verify link, which carries the proof after the <C>#</C> so it never reaches a server log.
        </p>
      ),
    },
    {
      id: 'revoke',
      title: '5 · Revoke it',
      body: (
        <>
          <Code>{`pof-prove history
pof-prove revoke <id> --endpoint ${'$'}SITE/api/revocations`}</Code>
          <p>Revoking publishes the proof’s revocation secret. Verifiers that check the list refuse the proof from then on.</p>
        </>
      ),
    },
    {
      id: 'demo',
      title: 'No ZEC? The demo ledger',
      body: (
        <p>
          <C>pof-prove demo prove</C> answers any request as the demo holder: 4,018.2 ZEC in five real Ironwood notes under a real key, in a
          published demo tree. The proofs are real; the anchor is labelled <C>demo</C> everywhere it appears. The same demo holder answers the
          “Prove as the demo holder” button on <C>/prove</C>.
        </p>
      ),
    },
  ],
}

const attestor: Doc = {
  slug: 'attestor',
  eyebrow: 'OPERATOR GUIDE',
  title: 'Running an attestor',
  lede: 'The one service that must hold a key. It is small, stateless and replaceable on purpose: anyone can run one, and a program can require several.',
  sections: [
    {
      id: 'run',
      title: 'Run one',
      body: (
        <Code>{`cd backend && cargo build --release -p pof-attest
POF_ATTEST_KEY=<64 hex chars, your Ed25519 seed> \\
POF_ANCHORS=frontend/src/data/anchors.json \\
POF_REVOCATIONS_URL=https://<site>/api/revocations \\
SOLANA_RPC_URL=https://api.devnet.solana.com \\
PORT=8787 ./target/release/pof-attest

curl localhost:8787/v1/pubkey   # your key, the verifier build, the key fingerprint`}</Code>
      ),
    },
    {
      id: 'api',
      title: 'Endpoints',
      body: (
        <Table
          head={['Route', 'Does']}
          rows={[
            ['POST /v1/attest', 'Runs pof-verify on {proof}; signs the 139-byte message if Valid and bound; 422 with the verdict otherwise.'],
            ['POST /v1/verify', 'The verdict, unsigned. For integrators who want a hosted check.'],
            ['GET /v1/pubkey', 'Public key, verifier version, verifying-key fingerprint.'],
            ['GET /v1/anchor/:h', 'The anchor records it trusts at a height.'],
            ['POST /v1/demo/prove', 'The demo holder (only when POF_DEMO_WORLD is set).'],
            ['GET /health', 'Liveness.'],
          ]}
        />
      ),
    },
    {
      id: 'allowlist',
      title: 'Getting on an allowlist',
      body: (
        <p>
          <C>pof-gate</C> keeps up to eight attestor keys and a threshold. With threshold 2, a receipt needs two distinct allowlisted attestors to
          have signed the identical message: one compromised attestor can no longer forge anything. The admin sets both with{' '}
          <C>set_attestors</C>; the setup script is <C>frontend/scripts/solana-setup.ts</C>.
        </p>
      ),
    },
    {
      id: 'logs',
      title: 'What it keeps',
      body: <p>Its key and a ten-second cache of the revocation list. It logs verdicts and latencies, never proof bytes, and holds no user data.</p>,
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
            ['Holder’s device', 'Keys and proving', 'Keys never leave it. The prover links no network client; nothing is broadcast.'],
            ['Zcash chain', 'The truth', 'Both anchor roots are rebuilt from public compact blocks, and nc_root is checked against lightwalletd.'],
            ['Anchor table', 'Which roots are real', 'Anyone can re-derive every entry with pof-anchor. A wrong entry can only make honest proofs fail.'],
            ['pof-verify', 'Checking', 'Open source, one implementation compiled natively and to WASM; every verdict can be re-derived.'],
            ['pof-attest', 'Solana only', 'Signs verdicts for a chain that cannot read Zcash. Allowlisted, k-of-n capable, and anyone can run one.'],
            ['Revocation list', 'Availability', 'A hash lock: only the holder knows the secret, so the list can drop an entry but never forge one.'],
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
            Verification of a Zcash fact by a Solana program goes through attestors. The program trusts its allowlist and threshold and nothing
            else. If enough allowlisted attestors lie together, the program believes them. That is the honest cost of v1.
          </p>
          <p>
            It is mitigated by making attestors boring and plural: stateless, re-runnable against the same proof and public data, and combinable
            (2 of 3 is a configuration change). A Zcash light client on Solana removes the attestor for the anchor; verifying the Halo2 proof
            inside a zkVM and checking a Groth16 wrapper on Solana removes it for the proof. Both are on the roadmap.
          </p>
        </>
      ),
    },
    {
      id: 'leak',
      title: 'What a leaked proof exposes',
      body: (
        <p>
          That some holder cleared a threshold at a block height, for a named audience, and nothing else: not the balance, not which notes or how
          many (the five slots are always filled), not the addresses. The governance nullifiers are unlinkable to on-chain nullifiers. A proof bound
          to a Solana account is useless to anyone else on-chain.
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
          <li>— Stop a holder spending the funds right after proving. Proofs are point-in-time; the anchor says which point.</li>
          <li>— Stop the same notes backing proofs to several audiences. Each proof is single-use where it lands (one receipt, one credit line), but the funds are not locked.</li>
          <li>— Prove more than five notes’ worth in one proof. A wallet with many small notes consolidates first.</li>
          <li>— Make an institution accept a proof. That is a conversation, not a feature.</li>
        </ul>
      ),
    },
    {
      id: 'demo',
      title: 'The demo ledger',
      body: (
        <p>
          So that anyone can see a real proof without owning ZEC, the site ships a demo ledger: a real key, five real Ironwood notes, and a published
          tree and nullifier set that are ours, not mainnet’s. Every verdict against it says “demo anchor”. Mainnet anchors come only from{' '}
          <C>pof-anchor</C>.
        </p>
      ),
    },
    {
      id: 'credits',
      title: 'What we built on',
      body: (
        <>
          <p>
            The holding proof is the delegation circuit from <A href={LINKS.votingCircuits}>voting-circuits</A> (Valar Group), driven the way{' '}
            <A href={LINKS.zcashVoting}>zcash_voting</A> (Chainapsis) drives it, over the Zakura Orchard/Ironwood crates; all MIT / Apache-2.0. We
            added one constraint (the threshold), a dense IMT, a precomputed-key loader, and a WASM build fix; each is listed in the vendored
            crate’s <C>VOUCH-MODIFICATIONS.md</C>.
          </p>
          <p>
            What we built is the envelope and its binding to the circuit, the anchor indexer, the prover and verifier, the attestor, the Solana
            programs and this site. No audit and no formal verification have been done. <strong>This is not production-ready.</strong>
          </p>
        </>
      ),
    },
  ],
}

const faq: Doc = {
  slug: 'faq',
  eyebrow: 'QUESTIONS',
  title: 'Asked before you ask',
  lede: 'The questions a lender, a regulator, a judge or a Zcash developer asks in the first five minutes.',
  sections: [
    { id: 'mixer', title: 'Is this a mixer?', body: <p>The opposite. A mixer hides; Vouch makes one fact visible again, to one named party, with an expiry. Nothing is moved and nothing is hidden that was not already hidden.</p> },
    { id: 'bridge', title: 'Is this a bridge?', body: <p>No. Nothing is bridged: the ZEC never leaves Zcash. Only a proof moves, and on Solana only a signed verdict about it.</p> },
    { id: 'exchange', title: 'Does it get shielded funds onto an exchange?', body: <p>No, and we do not pitch it that way. Exchanges ask where funds came from; Vouch proves how much you hold. It is for collateral and counterparty checks, where the question really is “do you have it”.</p> },
    { id: 'spend', title: 'What stops them spending right after proving?', body: <p>Nothing, and the proof says so: it is “as of” one block. For a loan, a lender asks for a fresh proof at each check. Continuous monitoring is a separate product.</p> },
    { id: 'viewingkey', title: 'Why not just use a viewing key?', body: <p>A viewing key shows every payment ever received, forever, and cannot be revoked or scoped. A proof shows one fact, to one party, until one date, and can be revoked.</p> },
    { id: 'notes', title: 'What if my ZEC is in many small notes?', body: <p>One proof covers up to five notes. Send yourself the amount first (a shielded self-transfer reveals nothing) so it sits in fewer notes, then prove.</p> },
    { id: 'orchard', title: 'Why Ironwood and not Orchard?', body: <p>Ironwood replaced Orchard in July 2026 after the Orchard counterfeiting flaw, and holders are migrating. Anything built against Orchard alone is built against a closing door.</p> },
    { id: 'reuse', title: 'What did you build versus reuse?', body: <p>See <A href="/docs/trust#credits">What we built on</A>. The circuit is Valar Group’s with one added constraint; everything around it is ours.</p> },
  ],
}

export const DOCS: Doc[] = [format, integration, prove, trust, attestor, faq]

export const getDoc = (slug: string) => DOCS.find((d) => d.slug === slug)
