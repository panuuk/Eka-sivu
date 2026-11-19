import { useStore } from '../store/store'
import { analyze, type Analysis } from './analyze'

/** Nykyisen projektin aukot ja valmiusaste. Tulos on välimuistissa projektin versiota kohti. */
export function useAnalysis(): Analysis {
  const project = useStore((s) => s.project)!
  return analyze(project)
}
