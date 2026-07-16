import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { BodyScan } from '@/types'

interface BodyStore {
  scans: BodyScan[]
  addScan: (scan: BodyScan) => void
  deleteScan: (id: string) => void
}

export const useBodyStore = create<BodyStore>()(
  persist(
    (set) => ({
      scans: [],

      addScan: (scan) => set((state) => ({
        scans: [...state.scans, { ...scan, id: Date.now().toString() }],
      })),

      deleteScan: (id) => set((state) => ({
        scans: state.scans.filter((s: any) => s.id !== id),
      })),
    }),
    {
      name: 'ledger.body',
    }
  )
)
