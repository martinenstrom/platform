/**
 * Live probe of the JARVIS → Financial OS gateway, through a real browser.
 *
 * Component and unit suites prove the gateway's semantics; this proves the
 * product can reach it. A headless Chromium loads HQ, imports the
 * client-transformed `serverFns` module exactly as a route would, and calls
 * `financialOsHostFn` through the production RPC path — `createClientRpc`,
 * the `x-tsr-serverFn` header, seroval framing and all. Nothing here forges
 * a request body.
 *
 * It manufactures no state. Every reference it reads is a case the firm
 * already holds; `ask` is sent only when the server has no operator
 * configured, so that the refusal — not a new case — is what gets measured.
 *
 *   node scripts/probe-host-gateway.mjs            (dev server on :5173)
 *   PROBE_BASE=http://localhost:3000 node scripts/probe-host-gateway.mjs
 */

import { chromium } from 'playwright'

const base = process.env.PROBE_BASE ?? 'http://localhost:5173'

const browser = await chromium.launch()
const page = await browser.newPage()

const rpc = []
page.on('request', (request) => {
  if (request.url().includes('_serverFn')) {
    rpc.push({
      method: request.method(),
      url: request.url().replace(base, ''),
      serverFnHeader: request.headers()['x-tsr-serverfn'] ?? null,
    })
  }
})
page.on('pageerror', (error) => console.error('[browser error]', error.message))

/* ------------------------------------------------------ HQ still renders */

await page.goto(`${base}/`, { waitUntil: 'networkidle' })
const hq = await page.evaluate(() => ({
  title: document.title,
  heading: document.querySelector('h1')?.textContent ?? null,
  /* `innerText` carries the CSS uppercase transform, so compare case-insensitively. */
  marketPanel: /marknadsöversikt/i.test(document.body.innerText),
  rail: [...document.querySelectorAll('aside nav a')].map((a) => a.textContent.trim()),
}))
console.log('HQ:', JSON.stringify(hq))

/* ---------------------------------------------------- through the gateway */

const results = await page.evaluate(async () => {
  const mod = await import('/src/infrastructure/analysis/serverFns.ts')
  const host = (data) => mod.financialOsHostFn({ data })
  const brief = (result) =>
    result.state === 'unsupported' || result.state === 'failed'
      ? result
      : {
          state: result.state,
          reference: result.reference,
          question: result.question,
          kind: result.kind ?? null,
          decision: result.decision ?? null,
          block: result.block ?? null,
          activity: {
            stage: result.activity.stage,
            desks: result.activity.desks.map((d) => d.name),
            outstanding: result.activity.outstanding,
            inFlight: result.activity.inFlight,
            expired: result.activity.expired,
            awaitingAdoption: result.activity.awaitingAdoption,
          },
          answer: result.answer
            ? {
                kind: result.answer.kind,
                outcome: result.answer.decision?.outcome ?? null,
                thesis: result.answer.thesis?.position ?? null,
                dissent: result.answer.dissent.length,
                material: result.answer.materialDissentCount,
                scrutiny: result.answer.scrutiny ?? null,
              }
            : undefined,
          inspection: result.inspection
            ? {
                view: result.inspection.view,
                entries: result.inspection.entries?.length,
                seats: result.inspection.seats?.length,
                objections: result.inspection.objections?.length,
                claims: result.inspection.claims?.length,
              }
            : undefined,
          surfaces: result.surfaces,
        }

  const out = { cases: {} }

  const list = await mod.getCaseListFn()
  const ids = list.ok ? list.cases.map((entry) => entry.investmentCase.id) : []
  for (const id of ids) {
    /* A provenance the host merely remembers — the firm must re-read regardless. */
    const reference = {
      system: 'financial-os',
      kind: 'case',
      id,
      provenanceId: 'as-remembered',
    }
    out.cases[id] = {
      status: brief(await host({ kind: 'status', reference })),
      result: brief(await host({ kind: 'result', reference })),
    }
  }

  const first = ids[0]
  if (first) {
    const reference = {
      system: 'financial-os',
      kind: 'case',
      id: first,
      provenanceId: 'x',
    }
    out.inspect = {
      debate: brief(await host({ kind: 'inspect', reference, view: { kind: 'debate' } })),
      objections: brief(
        await host({ kind: 'inspect', reference, view: { kind: 'objections' } }),
      ),
      ghostDesk: brief(
        await host({
          kind: 'inspect',
          reference,
          view: { kind: 'desk', departmentId: 'ghost' },
        }),
      ),
    }
  }

  out.unknownReference = await host({
    kind: 'status',
    reference: {
      system: 'financial-os',
      kind: 'case',
      id: 'case-does-not-exist',
      provenanceId: 'x',
    },
  })
  out.foreignReference = await host({
    kind: 'status',
    reference: {
      system: 'some-other-system',
      kind: 'case',
      id: first ?? 'x',
      provenanceId: 'x',
    },
  })
  out.actorRejected = await host({
    kind: 'ask',
    requestId: 'probe',
    question: 'x',
    subject: 'y',
    actingEmployeeId: 'verification-agent',
  })
  out.advanceRefused = await host({
    kind: 'advance',
    reference: {
      system: 'financial-os',
      kind: 'case',
      id: first ?? 'x',
      provenanceId: 'x',
    },
  })
  out.commandRefused = await host({
    kind: 'status',
    reference: {
      system: 'financial-os',
      kind: 'case',
      id: first ?? 'x',
      provenanceId: 'x',
    },
    command: 'AcceptContribution',
  })

  const operator = await mod.getCurrentOperatorFn()
  out.operator = operator.ok
    ? { ok: true, employeeId: operator.operator.employeeId }
    : operator
  if (!operator.ok) {
    /* Guaranteed to be refused before anything is written. */
    out.askWithoutOperator = await host({
      kind: 'ask',
      requestId: `probe-${Date.now()}`,
      question: 'Probe',
      subject: 'Probe',
    })
  } else {
    out.askWithoutOperator =
      'skipped: an operator is configured, so ask would open a real case'
  }

  return out
})

console.log('RPC calls seen:', rpc.length, JSON.stringify(rpc[0] ?? null))
console.log(JSON.stringify(results, null, 2))

await browser.close()
