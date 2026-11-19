import { useStore } from '../store/store'
import { Icon } from './Icon'

export function ErrorBar() {
  const error = useStore((s) => s.error)
  const clear = useStore((s) => s.clearError)
  if (!error) return null
  return (
    <div className="errorbar" role="alert">
      <Icon name="warn" />
      <span>{error}</span>
      <button type="button" className="icon-btn" aria-label="Sulje ilmoitus" onClick={clear}>
        <Icon name="x" size={16} />
      </button>
    </div>
  )
}
