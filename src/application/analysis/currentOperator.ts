/**
 * Who is actually using Financial OS.
 *
 * The smallest honest answer to a question the product could not previously
 * answer at all. Until now the acting employee arrived as a request parameter
 * chosen from a browser dropdown — `sessionStorage['financial-os:acting-as']` —
 * so the server recorded whichever identity the client asked it to. That is
 * adequate for a development console and unacceptable as the way a Chairman's
 * question gets attributed.
 *
 * ## What this is, precisely
 *
 * A **server-trusted configured operator**. The server reads one employee id
 * from its own configuration and resolves it against the seeded organisation.
 * The client is told who the operator is; it does not get to choose.
 *
 * ## What this is NOT
 *
 * Authentication. Nobody logged in, nothing was verified, and no credential was
 * presented. `actor_authentication` therefore stays `system-asserted` for every
 * act — the same value it has always had — because the record must not claim a
 * proof that does not exist. TD-8 remains open; this closes the part of it that
 * stops a browser naming its own author, and no more.
 *
 * ## Fail closed, in every direction
 *
 * Absent configuration, an unknown employee id or an employee the organisation
 * no longer holds all refuse. There is deliberately no fallback: defaulting to
 * the CIO, to the Research Director or to the first employee in the roster
 * would attribute a real institutional act to somebody who was never chosen,
 * which is the impersonation this exists to end.
 */

import type { Organization } from '~/domain/analysis'

/**
 * The environment variable naming the operator.
 *
 * Server-side only. It is an employee id, not a secret, but it is read from the
 * server's own configuration rather than accepted from a request — which is the
 * entire security property.
 */
export const OPERATOR_ENV = 'FINANCIAL_OS_OPERATOR_EMPLOYEE_ID'

export type OperatorRefusal =
  /** No operator is configured for this deployment. */
  | 'NOT_CONFIGURED'
  /** Configured, but the firm employs nobody with that id. */
  | 'UNKNOWN_EMPLOYEE'

export interface CurrentOperator {
  employeeId: string
  displayName: string
  departmentId: string
  roleId: string
  /**
   * Stated on the identity itself so no surface can imply otherwise.
   *
   * A configured operator is asserted by the server, not proven by a login.
   * The value is the same one the command ledger records.
   */
  authentication: 'system-asserted'
}

export type CurrentOperatorResult =
  | { ok: true; operator: CurrentOperator }
  | { ok: false; code: OperatorRefusal }

/**
 * Resolve the configured operator against the organisation.
 *
 * Takes the raw configured value rather than reading `process.env` itself, so
 * the institutional rule is testable without an environment — the same
 * boundary `ingestYields` and the market-data config already use.
 */
export function resolveCurrentOperator(
  configuredEmployeeId: string | undefined,
  organization: Organization,
): CurrentOperatorResult {
  const employeeId = configuredEmployeeId?.trim()
  if (!employeeId) return { ok: false, code: 'NOT_CONFIGURED' }

  const employee = organization.employees.find(
    (candidate) => candidate.id === employeeId,
  )
  /*
   * An id the firm does not employ is a configuration error, and it refuses
   * rather than falling back. A fallback here would put a real act against a
   * person nobody selected.
   */
  if (!employee) return { ok: false, code: 'UNKNOWN_EMPLOYEE' }

  return {
    ok: true,
    operator: {
      employeeId: employee.id,
      displayName: employee.displayName,
      departmentId: employee.departmentId,
      roleId: employee.roleId,
      authentication: 'system-asserted',
    },
  }
}
