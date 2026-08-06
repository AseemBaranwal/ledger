import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { scopedStorage } from '@/services/userScope'
import { detectUnitSystem, type UnitSystem } from '@/services/units'

interface UnitStore {
  unitSystem: UnitSystem | null // null until resolveDefault has run once
  setUnitSystem: (system: UnitSystem) => void
  // Locale-detects a default exactly once, the first time this device has
  // no stored preference yet — never overwrites an explicit choice (from
  // this call or a manual toggle) on later app opens, even if the device's
  // locale changes afterward (e.g. traveling).
  resolveDefault: () => void
}

export const useUnitStore = create<UnitStore>()(
  persist(
    (set, get) => ({
      unitSystem: null,

      setUnitSystem: (system) => set({ unitSystem: system }),

      resolveDefault: () => {
        if (get().unitSystem) return
        set({ unitSystem: detectUnitSystem() })
      },
    }),
    {
      name: 'ledger.units',
      storage: createJSONStorage(() => scopedStorage),
    }
  )
)
