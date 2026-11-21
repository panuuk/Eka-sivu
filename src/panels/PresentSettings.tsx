import { FONTS, type Palette } from '../export/theme'
import { useUi, type Heatmap } from '../store/ui'

const PALETTES: { id: Palette; label: string }[] = [
  { id: 'light', label: 'Vaalea' },
  { id: 'dark', label: 'Tumma' },
  { id: 'print', label: 'Tulostus (mustavalkoinen)' },
]

/** Esityksen ja vientien yhteiset asetukset: mitä näytetään ja miltä se näyttää. */
export function PresentSettings({ idPrefix = 'ps' }: { idPrefix?: string }) {
  const theme = useUi((s) => s.theme)
  const options = useUi((s) => s.present)
  const setTheme = useUi((s) => s.setTheme)
  const setOptions = useUi((s) => s.setPresentOptions)
  const check = (key: Exclude<keyof typeof options, 'heat'>, label: string, hint?: string) => (
    <label className="check" title={hint}>
      <input
        type="checkbox"
        checked={options[key]}
        onChange={(e) => setOptions({ [key]: e.target.checked })}
      />
      {label}
    </label>
  )
  return (
    <div className="present-settings">
      <fieldset>
        <legend className="field__label">Sisältö</legend>
        {check('expand', 'Avaa alaprosessit kuvaan')}
        {check(
          'onlyConfirmed',
          'Vain vahvistetut vaiheet',
          'Piilotettujen vaiheiden yli yhdistetään, jotta kulku säilyy',
        )}
        {check('showRoles', 'Näytä roolit')}
        {check('showSystems', 'Näytä järjestelmät')}
        {check('showUncertainty', 'Näytä varmuus (arvaukset katkoviivalla)')}
        {check('showMetrics', 'Näytä kestot ja kipupisteet')}
        <label className="gap-select">
          <span className="field__label">Väritys</span>
          <select
            id={`${idPrefix}-heat`}
            value={options.heat}
            onChange={(e) => setOptions({ heat: e.target.value as Heatmap })}
          >
            <option value="off">Ei väritystä</option>
            <option value="time">Aika (työ ja odotus)</option>
            <option value="pain">Kipupisteet</option>
            <option value="handoff">Luovutukset</option>
          </select>
        </label>
      </fieldset>
      <fieldset>
        <legend className="field__label">Ulkoasu</legend>
        <label className="gap-select">
          <span className="field__label">Väriteema</span>
          <select
            id={`${idPrefix}-palette`}
            value={theme.palette}
            onChange={(e) => setTheme({ palette: e.target.value as Palette })}
          >
            {PALETTES.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="gap-select">
          <span className="field__label">Fontti</span>
          <select
            id={`${idPrefix}-font`}
            value={theme.font}
            onChange={(e) => setTheme({ font: e.target.value })}
          >
            {FONTS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <label className="gap-select">
          <span className="field__label">Korostusväri</span>
          <input
            id={`${idPrefix}-accent`}
            type="color"
            value={theme.accent}
            disabled={theme.palette === 'print'}
            onChange={(e) => setTheme({ accent: e.target.value })}
            aria-label="Korostusväri"
          />
        </label>
      </fieldset>
    </div>
  )
}
