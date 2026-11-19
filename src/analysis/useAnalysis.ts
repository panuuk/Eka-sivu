import { useDeferredValue } from 'react'
import { useStore } from '../store/store'
import { analyze, type Analysis } from './analyze'

/**
 * Nykyisen projektin aukot ja valmiusaste. Analyysi lasketaan matalalla prioriteetilla (`useDeferredValue`),
 * jotta kirjoitus ja muu muokkaus pysyvät sujuvina isoillakin malleilla; tulos on välimuistissa projektin versiota kohti.
 */
export function useAnalysis(): Analysis {
  const project = useStore((s) => s.project)!
  return analyze(useDeferredValue(project))
}
