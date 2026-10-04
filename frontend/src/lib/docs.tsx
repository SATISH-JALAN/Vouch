import type { ReactNode } from 'react'
import { DEMO_AUDIENCE, ED25519_PROGRAM, IRONWOOD_ACTIVATION_HEIGHT, IRONWOOD_ACTIVATION_HEIGHT_TESTNET } from './data/chain'
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

// tabIndex: a block wider than the column scrolls sideways, and a keyboard has to be able to scroll it too
const Code = ({ children }: { children: string }) => (
  <pre tabIndex={0} className="t-data my-6 overflow-x-auto rounded-chip border border-border bg-bone-2 p-5 text-ink" data-lenis-prevent="">
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
  <div tabIndex={0} role="region" aria-label={head.join(', ')} className="my-6 overflow-x-auto">
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
  eyebrow: 'SPECIFICATION · VERSIONS 1 AND 2',
  title: 'The proof format',
  lede: 'A .pof file carries one claim, for one audience and period, bound to one context, anchored to the chain, with an expiry and a revocation tag. Version 2 adds “unmoved since block H”, scopes in which reuse is visible, and exit certificates. This page is written so that someone else can implement a verifier against it.',
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
            proof is about 11,900 bytes.
          </p>
          <Code>{` magic      "POF1"                 4 bytes   50 4F 46 31
 version    u16, little-endian     2 bytes   01 00 or 02 00
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
          <p>
            <strong>Version 2</strong> (written by current provers):
          </p>
          <Code>{`circuit      u8         1 = threshold · 2 = threshold + revealed nullifiers (exit certificates)
claim        enum Claim                      (varint tag + fields)
audience     [u8; 32]   blake2b-256("pof-audience:" ‖ lowercase(trim(id)))
epoch        u64        the verifier's period; with circuit and audience it is the scope
binding      [u8; 32]   all zero · a Solana pubkey · blake2b("vouch-intent-v1", deposit intent)
nc_height    u32        the block whose note-commitment tree holds the notes
nc_root      [u8; 32]
height       u32        the block whose spent set does not hold them ("as of")
nf_root      [u8; 32]   nc_height ≤ height; equal unless the proof says "unmoved since"
issued_at    u64
expires_at   u64
revocation   [u8; 16]
evidence     { public_inputs: Vec<[u8; 32]>, proof: Vec<u8>, signature: [u8; 64] }`}</Code>
          <p>
            <strong>Version 1</strong> (still read, and re-encoded byte for byte):
          </p>
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
              ['evidence', '9 public inputs (15 for circuit 2), the Halo2 proof, and the spend-authorisation signature.'],
              ['epoch', 'Chosen by the verifier in its request. A proof made without one gets a scope of its own, so it links to nothing.'],
              ['nc_height', 'When earlier than height, the notes were already in the chain at nc_height and have not moved since.'],
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
            The <strong>statement</strong> is every body field except the evidence. The holder signs it, with every public input, under the key the
            circuit proves controls the notes, so changing any field — the claim, audience, epoch, binding, either anchor height, the expiry —
            fails the signature. In version 1 the circuit’s <C>vote_round_id</C> is also the statement hash. In version 2 it is the{' '}
            <strong>scope</strong>: the circuit, audience and epoch. The same note then yields the same tag inside one scope, so a verifier sees the
            same coins used twice with it, and nobody else can link anything.
          </p>
          <Code>{`statement  = blake2b-256[personal "vouch-stmt-v1"](head)
scope      = blake2b-256[personal "vouch-scope-v2"](circuit ‖ audience ‖ epoch_le)   (version 2)
round_id   = statement (v1) or scope (v2), bits 254..255 cleared, as a Pallas base element
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
            The circuit checks each note slot on its own, so it would accept one note placed in several slots and count it more than once.
            Upstream, the vote chain refuses a repeated governance nullifier; Vouch has no chain, so the verifier refuses any proof whose five{' '}
            <C>gov_null</C> values are not all distinct. A repeated note always produces the same one.
          </p>
          <p>
            Carried public inputs, in order: <C>nf_signed, rk, cmx_new, van_comm, gov_null_1..5</C>. Derived by the verifier: <C>vote_round_id</C>,{' '}
            <C>dom</C>, <C>nc_root</C>, <C>nf_imt_root</C>, <C>min_ballots</C>. The governance nullifiers (tags) are domain-separated per scope and
            unlinkable to the real nullifiers.
          </p>
          <p>
            <C>nc_root</C> and <C>nf_imt_root</C> are independent public inputs. Taking the first at an earlier block than the second proves the
            notes existed then and are unspent now: the tree only grows, and a note moves only by revealing its nullifier.
          </p>
          <p>
            <strong>Circuit 2</strong> (exit certificates) is the same circuit with a second Vouch modification: a boolean <C>reveal</C> (public
            input 15) and <C>reveal × real_nf</C> for each slot (16–20). With <C>reveal = 1</C> the five real nullifiers are public, so a recipient
            can match a deposit to exactly the certified notes; with <C>0</C> they are forced to zero. It has its own verifying key; circuit 1’s is
            unchanged. Carried inputs for circuit 2: the nine above, then <C>reveal, revealed_nf_1..5</C>.
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
              ['4', 'blake2b(identifier) equals audience; the epoch is the one the verifier asked for, if it asked', <><C>WrongAudience</C> · <C>WrongScope</C></>],
              [
                '5',
                'The note-commitment root at nc_height and the spent-set root at height are both authenticated; the spent set is fresh enough and the notes unmoved long enough for the verifier’s policy',
                <><C>AnchorNotFound</C> · <C>AnchorTooOld</C> · <C>NotDormantLongEnough</C></>,
              ],
              ['6', 'Distinct tags, the signature under rk, the Halo2 proof against the circuit’s key; then none of the tags is in the verifier’s reuse registry', <><C>ProofInvalid</C> · <C>AlreadyUsed</C></>],
            ]}
          />
          <Code>{`pub enum Verdict {
    Valid { claim: Claim, anchor_height: u32, dormant_since: Option<u32> },
    Expired { at: u64 },
    Revoked,
    WrongAudience,
    AnchorNotFound,
    AnchorTooOld { anchor_height: u32 },
    NotDormantLongEnough { dormant_since: u32, required: u32 },
    WrongScope { epoch: u64, required: u64 },
    AlreadyUsed,
    ProofInvalid { detail: String },
    Malformed { reason: String },
}

pub struct Policy {            // what this verifier additionally requires; all optional
    tip_height: Option<u32>,   // with max_anchor_age: refuse a stale spent set
    max_anchor_age: Option<u32>,
    dormant_since: Option<u32>, // notes unmoved since this block or earlier
    epoch: Option<u64>,         // the period the request named
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
          <p>
            Zcash testnet works the same way (Ironwood from block {formatInt(IRONWOOD_ACTIVATION_HEIGHT_TESTNET)}): <C>pof-anchor scan --network testnet</C>{' '}
            reads <C>testnet.zec.rocks</C> and records <C>network: &quot;testnet&quot;</C>. Verdicts on a testnet anchor say so: the proof is real, the
            coins (TAZ) have no monetary value. The network is recorded in the anchor table, not in the proof or the attestation, so a verifier that
            only wants mainnet should trust only mainnet anchors.
          </p>
        </>
      ),
    },
    {
      id: 'reserves',
      title: 'Reserves batches',
      body: (
        <>
          <p>
            A holder with more than five notes, or a treasury, proves its reserves as a batch: several version 2 proofs in one scope and against one
            anchor, in a <C>.pofb</C> container. The verifier checks every member, refuses a batch in which any tag appears twice (a note counted
            twice), and states the sum. Natively the members’ Halo2 proofs are checked together, with one multi-scalar multiplication.
          </p>
          <Code>{` magic      "POFB"                 4 bytes
 version    u16, little-endian     2 bytes   01 00
 count      u16, little-endian     2 bytes   1 … 64
 members    count × (u32 LE length ‖ a complete POF1 file)
 checksum   blake2b-256 of everything before it`}</Code>
          <p>
            Check one at <A href="/reserves">/reserves</A>, or with <C>pof-verify check reserves.pofb</C>. On Solana, <C>pof-reserve</C> turns an
            attested batch into a feed that any program can read, and its demo token mints only within the proven total.
          </p>
        </>
      ),
    },
    {
      id: 'json',
      title: 'As JSON',
      body: (
        <>
          <p>
            Every verifier returns the same JSON for a file: the WASM <C>verify()</C>, <C>pof-verify check --json</C> and the attestor’s{' '}
            <C>/v1/verify</C>. It holds the verdict, the six checks in order, the matched anchor record, the proof’s <C>scope</C> and <C>tags</C>
            (for a reuse registry), an exit certificate’s <C>revealed</C> nullifiers, and <C>envelope</C>, the JSON projection
            of the proof itself (hex in lowercase, amounts in zatoshi, times in unix seconds). Its JSON Schema is published at{' '}
            <A href="/schema/pof-v1.json">/schema/pof-v1.json</A>, and CI checks every test vector’s result against it.
          </p>
          <Code>{`{ "verdict":  { "kind": "Valid", "claim": { "kind": "HoldsAtLeast", "zatoshi": 100000000 }, "anchorHeight": 4410000 },
  "checks":   [ { "id": "format", "label": "…", "status": "pass", "detail": "…" }, … ],
  "envelope": { "version": 1, "claim": { … }, "audience": "412a96…", "binding": "0000…", "anchor": { … },
                "issuedAt": 1790622467, "expiresAt": 1800990467, "revocation": "704960c1…", "evidence": { … } },
  "sizeBytes": 11884, "checksum": "c82489…", "anchor": { "network": "testnet", "height": 4410000, … },
  "now": 1790693805, "verifier": "pof-verify 0.1.0" }`}</Code>
        </>
      ),
    },
    {
      id: 'example',
      title: 'Test vectors',
      body: (
        <>
          <p>
            Every preset on <A href="/verify">/verify</A> is a real proof committed in <A href={`${REPO}/tree/main/fixtures`}>fixtures/</A>,
            together with the verdict each must produce. The native verifier, the WASM verifier and the TypeScript codec are all checked against
            that one list in CI.
          </p>
          <p>
            The first, <C>testnet-valid.pof</C>, was made by <C>pof-prove prove</C> from a real Zcash testnet wallet: at least 1 TAZ, as of testnet
            block 4,410,000, for the audience <C>vouch:testnet-demo</C>. Its tampered, forged and re-addressed copies sit beside it. The rest were
            written by <C>pof-prove demo fixtures</C> against the demo ledger, for the audience <C>{DEMO_AUDIENCE.id}</C>.
          </p>
        </>
      ),
    },
  ],
}

const rail: Doc = {
  slug: 'rail',
  eyebrow: 'GUIDE · FOR RAILS',
  title: 'Exit certificates',
  lede: 'For a swap rail, an exchange or a desk that receives shielded ZEC: ask for a certificate, check it under your own policy, and match the deposit when it lands. Vouch returns evidence; you decide.',
  sections: [
    {
      id: 'ask',
      title: '1 · Ask',
      body: (
        <>
          <p>
            Build a request at <A href="/request">/request</A> with <strong>Exit certificate</strong> selected. It names your identifier, a period
            (this month by default) and, if your policy wants one, a block the coins must be unmoved since — for example a block before a known
            incident. Hand the link to the holder with the deposit address.
          </p>
          <Code>{`{ "v": 1, "id": "c1ea4e7e5a1f0002", "claim": "HoldsAtLeast", "zatoshi": "100000000",
  "audience": "rail:example", "expiryDays": 7, "kind": "exit", "epoch": 202610, "dormantSince": 4410000 }`}</Code>
          <p>
            The holder runs <C>pof-prove prove --request …</C>. An exit certificate names every usable note (up to five), bound to the request id
            as the deposit intent. The holder must send from those notes in a transaction with no dummy spends: two or more certified notes in, no
            more outputs than spends.
          </p>
        </>
      ),
    },
    {
      id: 'check',
      title: '2 · Check the certificate',
      body: (
        <>
          <Code>{`pof-verify check certificate.pof --audience rail:example --anchors anchors.json \
  --epoch 202610 --dormant-since 4410000 --seen your-registry.json`}</Code>
          <p>
            Valid means: at least that much, in notes unmoved since the block, made for you in this period, and none of these notes already used
            with you this period. Record the result’s <C>tags</C> in your registry. Or run the same check in the browser at{' '}
            <A href="/rail">/rail</A>, or through the attestor’s API:
          </p>
          <Code>{`POST /v1/certificates   { "certificate": "<base64url>", "audience": "rail:example", "epoch": 202610,
                          "dormantSince": 4410000, "intent": "c1ea4e7e5a1f0002" }
→ { "status": "pre-cleared", "certificate": { "id": "…", "revealed": [ … ], "tags": [ … ] }, "result": { … } }`}</Code>
        </>
      ),
    },
    {
      id: 'match',
      title: '3 · Match the deposit',
      body: (
        <>
          <Code>{`pof-anchor tx --network testnet --txid <deposit txid> > deposit.json
pof-verify match --cert certificate.pof --deposit deposit.json        # exit 0: matched

POST /v1/certificates/{id}/match   { "txid": "<deposit txid>" }
→ { "status": "matched" | "mismatch", "certificate": { "deposit": { "result": { "kind": "Matched", "spent": 2 } } } }`}</Code>
          <p>
            Matched means every note the deposit spends is one the certificate named. Value inside one transaction is pooled, so a single
            uncertified spend makes the whole deposit a mismatch. A dummy spend reveals a nullifier that looks exactly like an uncertified note,
            which is why exit transactions must be built without them.
          </p>
          <p>
            The API signs events to your webhook (<C>POF_WEBHOOK_URL</C>, <C>X-Vouch-Signature: sha256=&lt;hmac&gt;</C>) and needs a bearer
            token when <C>POF_RAIL_TOKEN</C> is set. It stores ids, tags, revealed nullifiers and verdicts, never proof bytes.
          </p>
        </>
      ),
    },
    {
      id: 'limits',
      title: 'What it does not say',
      body: (
        <>
          <p>
            Unmoved since block H says when the coins last moved, not where they were before H. Coins stolen long before H and left untouched would
            pass, which is why H is your policy’s choice. It is evidence for your risk process, never a “clean” stamp, and it is not a legal
            answer to any regulation.
          </p>
          <p>
            The rail sees the certified notes’ nullifiers before the deposit lands, so it could see if the holder spent them elsewhere instead.
            Holders are told to make certificates only when they are ready to send.
          </p>
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
echo $?   # 0 valid · 1 invalid · 2 expired · 3 malformed · 4 could not run`}</Code>
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
            then calls <C>mark_consumed</C> by CPI, signed by the beneficiary and by the consumer program’s own <C>[b"consumer"]</C> PDA.{' '}
            <C>pof-gate</C> derives that PDA from the program passed as <C>consumer_program</C>, so a plain key cannot pose as a consumer, and
            records the program id in <C>consumed_by</C>. <C>pof-credit</C> does exactly that; in the demo the relayer pays the credit line’s rent,
            so the borrower needs no SOL.
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
          <p>
            The prover is one binary; nothing else is installed. Each <A href={`${REPO}/releases/latest`}>release</A> has pof-prove,
            pof-verify and pof-anchor built for macOS (Apple silicon), Linux and Windows, with a SHA-256 beside every archive.
          </p>
          <Code>{`curl -fL ${REPO}/releases/latest/download/vouch-linux-x86_64.tar.gz | tar xz   # or vouch-macos-arm64.tar.gz, vouch-windows-x86_64.zip
# or with Rust 1.91 or newer
cargo install --git ${REPO} pof-prove --locked
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
pof-anchor scan --server https://zec.rocks:443 --to ${mainnet?.height ?? 3493000}
# ✓ nc_root matches lightwalletd's Ironwood tree state at ${mainnet?.height ?? 3493000}`}</Code>
          <p>
            It writes <C>target/snapshots/mainnet-&lt;height&gt;.vsnp</C>, the path the command on <C>/prove</C> expects. The anchor it prints must
            match the one published in the table, or verifiers will answer AnchorNotFound.
          </p>
          <p>
            On Zcash testnet add <C>--network testnet</C>: the server, start height and table switch to testnet, the snapshot is{' '}
            <C>target/snapshots/testnet-&lt;height&gt;.vsnp</C>, and <C>pof-prove</C> takes the network (ZIP 32 coin type 1) from it.
          </p>
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
          <Code>{`pof-prove prove --request <encoded> --snapshot target/snapshots/mainnet-${mainnet?.height ?? 3493000}.vsnp \\
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
          have signed the identical message: one compromised attestor can no longer forge anything. The first <C>initialize</C> must be
          signed by <C>pof-gate</C>’s upgrade authority, so nobody can claim the config before the deployer; after that the admin sets both
          with <C>set_attestors</C>. The setup script is <C>frontend/scripts/solana-setup.ts</C>.
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
          <li>
            — Stop a holder spending the funds right after proving. Proofs are point-in-time; the anchor says which point. A consumer has to ask
            again, as a lender asks for a new bank statement: <C>pof-credit</C> draws only while a line’s latest proof is fresh (24 hours by
            default, never past the proof’s expiry), and a refresh needs a new proof at an anchor no older than the line’s last or the pool’s
            floor. A holder who spent the funds cannot make one.
          </li>
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
    {
      id: 'exchange',
      title: 'Does it get shielded funds through an exchange or a swap?',
      body: (
        <p>
          It gives the rail evidence, not a pass. An exit certificate shows the coins were already in the chain at a block the rail picks (say,
          before an incident) and have not moved since, and names them, so the deposit can be matched to exactly them. Whether that releases a
          held deposit is the rail’s policy. See <A href="/docs/rail">Exit certificates</A>.
        </p>
      ),
    },
    {
      id: 'clean',
      title: 'Does it prove the coins are clean?',
      body: (
        <p>
          No, and it never says so. It proves when the coins last moved, not where they were before. Tracing shielded funds is impossible by
          design; that is what the shielded pool is for. Coins stolen long before the block a rail picks, and left untouched, would pass, which is
          why the block is the rail’s choice.
        </p>
      ),
    },
    {
      id: 'spend',
      title: 'What stops them spending right after proving?',
      body: (
        <p>
          Nothing, and the proof says so: it is “as of” one block. A lender asks for a fresh proof at each check, can require a recent spent set,
          and, by naming a period in its request, sees the same coins pledged twice to it. An exit certificate is different: it names the coins,
          and the rail matches them against the deposit itself.
        </p>
      ),
    },
    { id: 'viewingkey', title: 'Why not just use a viewing key?', body: <p>A viewing key shows every payment ever received, forever, and cannot be revoked or scoped. A proof shows one fact, to one party, until one date, and can be revoked.</p> },
    {
      id: 'notes',
      title: 'What if my ZEC is in many small notes?',
      body: (
        <p>
          One proof covers up to five notes. Prove a batch instead (<A href="/reserves">reserves</A>): several proofs, one total, no note counted
          twice. Or send yourself the amount first so it sits in fewer notes; but a self-transfer makes new notes, so it restarts any “unmoved
          since” clock.
        </p>
      ),
    },
    { id: 'orchard', title: 'Why Ironwood and not Orchard?', body: <p>Ironwood replaced Orchard in July 2026 after the Orchard counterfeiting flaw, and holders are migrating. Anything built against Orchard alone is built against a closing door.</p> },
    { id: 'reuse', title: 'What did you build versus reuse?', body: <p>See <A href="/docs/trust#credits">What we built on</A>. The circuit is Valar Group’s with two Vouch additions (the threshold, and the optional revealed nullifiers of exit certificates); everything around it is ours.</p> },
  ],
}

export const DOCS: Doc[] = [format, integration, rail, prove, trust, attestor, faq]

export const getDoc = (slug: string) => DOCS.find((d) => d.slug === slug)
