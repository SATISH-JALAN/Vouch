// Forwards a proof request to the demo holder inside pof-attest, which proves it against the
// demo ledger with the demo key. For visitors without ZEC; real holders run pof-prove locally.
import { proxyToAttestor } from '@/lib/server/http'

export const maxDuration = 60

export function POST(req: Request) {
  return proxyToAttestor(req, {
    path: '/v1/demo/prove',
    limit: ['prove', 10],
    timeoutMs: 55_000,
    unconfigured: 'the demo holder is not configured on this deployment (POF_ATTEST_URL is unset)',
    slowDown: 'too many proofs in a minute; try again shortly',
    unreachable: 'demo holder unreachable',
  })
}
