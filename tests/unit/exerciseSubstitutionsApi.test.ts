import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchSubstitutions, saveSubstitution, removeSubstitution } from '@/services/exerciseSubstitutionsApi'
import { supabase } from '@/services/supabaseClient'
import { setCurrentUserId } from '@/services/userScope'

vi.mock('@/services/supabaseClient', () => ({
  supabase: { from: vi.fn() },
}))

describe('fetchSubstitutions', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the stored substitutions map', async () => {
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      single: () => Promise.resolve({ data: { exercise_substitutions: { SQ: { code: 'LEG_PRESS', name: 'Leg Press', group: 'Legs', unit: 'lb' } } }, error: null }),
    }
    vi.mocked(supabase.from).mockReturnValue(chain)

    await expect(fetchSubstitutions('user-1')).resolves.toEqual({
      SQ: { code: 'LEG_PRESS', name: 'Leg Press', group: 'Legs', unit: 'lb' },
    })
  })

  it('throws on a query error instead of returning an empty map silently', async () => {
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      single: () => Promise.resolve({ data: null, error: { message: 'network error' } }),
    }
    vi.mocked(supabase.from).mockReturnValue(chain)

    await expect(fetchSubstitutions('user-1')).rejects.toThrow('network error')
  })
})

describe('saveSubstitution', () => {
  beforeEach(() => {
    setCurrentUserId('user-1')
    vi.clearAllMocks()
  })

  it('throws when nobody is signed in, before attempting any query', async () => {
    setCurrentUserId(null)

    await expect(
      saveSubstitution('SQ', { code: 'LEG_PRESS', name: 'Leg Press', group: 'Legs', unit: 'lb' })
    ).rejects.toThrow('Not signed in')
    expect(supabase.from).not.toHaveBeenCalled()
  })

  // Read-modify-write: must merge into whatever's already there instead of
  // clobbering other exercises' standing substitutions.
  it('merges the new substitution into the existing map rather than replacing it', async () => {
    const updatedPayloads: unknown[] = []
    const selectChain: any = {
      select: () => selectChain,
      eq: () => selectChain,
      single: () => Promise.resolve({ data: { exercise_substitutions: { RDL: { code: 'GOOD_MORNING', name: 'Good Morning', group: 'Legs', unit: 'lb' } } }, error: null }),
    }
    const updateChain: any = {
      update: (payload: unknown) => {
        updatedPayloads.push(payload)
        return updateChain
      },
      eq: () => Promise.resolve({ error: null }),
    }
    vi.mocked(supabase.from)
      .mockReturnValueOnce(selectChain)
      .mockReturnValueOnce(updateChain)

    await saveSubstitution('SQ', { code: 'LEG_PRESS', name: 'Leg Press', group: 'Legs', unit: 'lb' })

    expect(updatedPayloads).toEqual([
      {
        exercise_substitutions: {
          RDL: { code: 'GOOD_MORNING', name: 'Good Morning', group: 'Legs', unit: 'lb' },
          SQ: { code: 'LEG_PRESS', name: 'Leg Press', group: 'Legs', unit: 'lb' },
        },
      },
    ])
  })

  it('throws with the Supabase error message when the update fails, instead of resolving silently', async () => {
    const selectChain: any = {
      select: () => selectChain,
      eq: () => selectChain,
      single: () => Promise.resolve({ data: { exercise_substitutions: {} }, error: null }),
    }
    const updateChain: any = {
      update: () => updateChain,
      eq: () => Promise.resolve({ error: { message: 'new row violates row-level security policy' } }),
    }
    vi.mocked(supabase.from)
      .mockReturnValueOnce(selectChain)
      .mockReturnValueOnce(updateChain)

    await expect(
      saveSubstitution('SQ', { code: 'LEG_PRESS', name: 'Leg Press', group: 'Legs', unit: 'lb' })
    ).rejects.toThrow('new row violates row-level security policy')
  })
})

// Regression coverage for issue #89: until this existed, nothing anywhere
// in the codebase could clear a standing substitution — only ever replace
// it with a different one. That gap is what let a real substitution
// mistake become permanently stuck on a live account.
describe('removeSubstitution', () => {
  beforeEach(() => {
    setCurrentUserId('user-1')
    vi.clearAllMocks()
  })

  it('throws when nobody is signed in, before attempting any query', async () => {
    setCurrentUserId(null)

    await expect(removeSubstitution('SQ')).rejects.toThrow('Not signed in')
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('removes only the targeted code, leaving other substitutions untouched', async () => {
    const updatedPayloads: unknown[] = []
    const selectChain: any = {
      select: () => selectChain,
      eq: () => selectChain,
      single: () =>
        Promise.resolve({
          data: {
            exercise_substitutions: {
              SQ: { code: 'BARBELL_BACK_SQUAT', name: 'Barbell Back Squat', group: 'Legs', unit: 'lb' },
              RDL: { code: 'GOOD_MORNING', name: 'Good Morning', group: 'Legs', unit: 'lb' },
            },
          },
          error: null,
        }),
    }
    const updateChain: any = {
      update: (payload: unknown) => {
        updatedPayloads.push(payload)
        return updateChain
      },
      eq: () => Promise.resolve({ error: null }),
    }
    vi.mocked(supabase.from).mockReturnValueOnce(selectChain).mockReturnValueOnce(updateChain)

    await removeSubstitution('SQ')

    expect(updatedPayloads).toEqual([
      { exercise_substitutions: { RDL: { code: 'GOOD_MORNING', name: 'Good Morning', group: 'Legs', unit: 'lb' } } },
    ])
  })

  it('throws with the Supabase error message when the update fails', async () => {
    const selectChain: any = {
      select: () => selectChain,
      eq: () => selectChain,
      single: () => Promise.resolve({ data: { exercise_substitutions: { SQ: { code: 'X', name: 'X', group: 'Legs', unit: 'lb' } } }, error: null }),
    }
    const updateChain: any = {
      update: () => updateChain,
      eq: () => Promise.resolve({ error: { message: 'network error' } }),
    }
    vi.mocked(supabase.from).mockReturnValueOnce(selectChain).mockReturnValueOnce(updateChain)

    await expect(removeSubstitution('SQ')).rejects.toThrow('network error')
  })
})
