'use client'

import { create } from 'zustand'

interface IntroState {
  /** True once the preloader has started its exit (or was skipped / never shown). */
  introDone: boolean
  setIntroDone: () => void
}

export const useIntro = create<IntroState>((set) => ({
  introDone: false,
  setIntroDone: () => set({ introDone: true }),
}))
