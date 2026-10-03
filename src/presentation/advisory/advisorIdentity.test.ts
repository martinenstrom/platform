/**
 * The advisor's identity on a surface: the full name and the portrait the
 * presentation holds, the record's own name where it holds none, and the
 * one advisor the synthetic workspace is read for.
 */

import { describe, expect, it } from 'vitest'
import {
  advisorIdentityOf,
  WORKSPACE_ADVISOR_ID,
  workspaceAdvisor,
} from './advisorIdentity'

describe('the advisor identity', () => {
  it('names Martin in full, with his role and portrait, from the record’s first name', () => {
    expect(advisorIdentityOf({ id: 'adv-martin', displayName: 'Martin' })).toEqual({
      advisorId: 'adv-martin',
      fullName: 'Martin Enström',
      roleTitle: 'Private Banking',
      portraitUrl: '/data/advisors/martin-enstrom.jpg',
    })
  })

  it('keeps the record’s name and shows no portrait for an advisor the presentation has not mapped', () => {
    expect(advisorIdentityOf({ id: 'adv-sofia', displayName: 'Sofia' })).toEqual({
      advisorId: 'adv-sofia',
      fullName: 'Sofia',
      roleTitle: 'Private Banking',
      portraitUrl: null,
    })
    expect(advisorIdentityOf('adv-nobody').fullName).toBe('adv-nobody')
  })

  it('reads the synthetic workspace as Martin’s book', () => {
    expect(WORKSPACE_ADVISOR_ID).toBe('adv-martin')
    expect(workspaceAdvisor().fullName).toBe('Martin Enström')
  })
})
