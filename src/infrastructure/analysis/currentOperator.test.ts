/**
 * Who the server says is using Financial OS.
 *
 * The property under test is that the answer comes from the SERVER's
 * configuration and from the organisation — never from a caller, and never from
 * a fallback. Every refusal case here exists because the alternative is
 * attributing a real institutional act to somebody nobody chose.
 */

import { describe, expect, it } from 'vitest'
import { resolveCurrentOperator } from '~/application/analysis/currentOperator'
import { TEST_ORGANIZATION } from './testOrganization'

const organization = TEST_ORGANIZATION

describe('the configured operator', () => {
  it('resolves to a real employee of the firm', () => {
    const result = resolveCurrentOperator('macro-head', organization)
    expect(result).toEqual({
      ok: true,
      operator: {
        employeeId: 'macro-head',
        displayName: expect.any(String),
        departmentId: 'global-macro',
        roleId: expect.any(String),
        /* The organisation's title for the role — what a surface shows beside the name. */
        roleTitle: expect.any(String),
        authentication: 'system-asserted',
      },
    })
  })

  it('never claims the operator was authenticated', () => {
    /*
     * Nobody logged in. The identity is asserted by the server's configuration,
     * and the record says exactly that — the same value the command ledger
     * carries. TD-8 is not closed by configuring a name.
     */
    const result = resolveCurrentOperator('macro-head', organization)
    if (!result.ok) throw new Error('expected an operator')
    expect(result.operator.authentication).toBe('system-asserted')
  })
})

describe('it fails closed rather than choosing somebody', () => {
  it('refuses when nothing is configured', () => {
    expect(resolveCurrentOperator(undefined, organization)).toEqual({
      ok: false,
      code: 'NOT_CONFIGURED',
    })
  })

  it('refuses an empty or whitespace configuration', () => {
    expect(resolveCurrentOperator('', organization).ok).toBe(false)
    expect(resolveCurrentOperator('   ', organization).ok).toBe(false)
  })

  it('refuses an id the firm does not employ', () => {
    expect(resolveCurrentOperator('not-an-employee', organization)).toEqual({
      ok: false,
      code: 'UNKNOWN_EMPLOYEE',
    })
  })

  it('never falls back to the chief, a manager, or the first employee', () => {
    /*
     * The failure this prevents is silent and institutional: a default would
     * put a real act — a question, a commissioning, an acceptance — against a
     * person who was never selected, in a record whose whole purpose is to say
     * who did what.
     */
    for (const configured of [undefined, '', 'nobody']) {
      const result = resolveCurrentOperator(configured, organization)
      expect(result.ok).toBe(false)
      expect(JSON.stringify(result)).not.toContain('cio')
      expect(JSON.stringify(result)).not.toContain('research-director')
      expect(JSON.stringify(result)).not.toContain(organization.employees[0]!.id)
    }
  })

  it('does not resolve an operator from a caller-supplied organisation position', () => {
    /* Only an employee id resolves. A department or role name is not identity. */
    expect(resolveCurrentOperator('global-macro', organization).ok).toBe(false)
    expect(resolveCurrentOperator('manager', organization).ok).toBe(false)
  })
})
