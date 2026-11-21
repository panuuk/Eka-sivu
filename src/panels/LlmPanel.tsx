import { useEffect } from 'react'
import { isLocalUrl } from '../capture/llm'
import { useLlm } from '../store/llm'
import type { Source } from '../model/types'

const pct = (x: number) => `${Math.round(x * 100)} %`

/** Valinnainen paikallinen kielimalli: asetukset, ajo lähteelle ja mittaus arviointiaineistolla. */
export function LlmPanel({ source }: { source: Source }) {
  const config = useLlm((s) => s.config)
  const models = useLlm((s) => s.models)
  const modelsError = useLlm((s) => s.modelsError)
  const running = useLlm((s) => s.running)
  const error = useLlm((s) => s.error)
  const result = useLlm((s) => s.results[source.id])
  const mode = useLlm((s) => s.mode[source.id] ?? 'rules')
  const benchmark = useLlm((s) => s.benchmark)
  const llm = useLlm.getState()
  const valid = result && result.textLength === source.text.length

  useEffect(() => {
    // Valittu tulos vanhenee, kun lähdeteksti muuttuu
    if (result && !valid && mode === 'llm') useLlm.getState().setMode(source.id, 'rules')
  }, [result, valid, mode, source.id])

  return (
    <details className="llm" data-testid="llm-panel">
      <summary>Kielimalli (valinnainen){valid && mode === 'llm' ? ' · käytössä' : ''}</summary>
      <div className="llm__body">
        <p className="field__hint">
          Voit ajaa tekstin omalla koneellasi toimivalla kielimallilla (esim. Ollama tai LM Studio).
          Teksti lähetetään vain tähän osoitteeseen. Mallin ehdotukset kulkevat saman hyväksynnän
          läpi kuin muutkin, ja jokaisen on löydyttävä lähdetekstistä. Mittaa malli ensin
          arviointiaineistolla: se on käyttökelpoinen vain, jos se on sääntöjä parempi.
        </p>
        <label className="field">
          <span className="field__label">Osoite (OpenAI-yhteensopiva)</span>
          <input
            value={config.baseUrl}
            onChange={(e) => llm.setConfig({ baseUrl: e.target.value })}
            aria-label="Kielimallin osoite"
          />
        </label>
        {!isLocalUrl(config.baseUrl) && (
          <p className="issue issue--warning" data-testid="llm-remote-warning">
            Osoite ei ole omalla koneellasi tai paikallisessa verkossa. Teksti lähtisi koneelta.
          </p>
        )}
        <div className="llm__row">
          <label className="field llm__model">
            <span className="field__label">Malli</span>
            {models.length > 0 ? (
              <select
                value={config.model}
                onChange={(e) => llm.setConfig({ model: e.target.value })}
                aria-label="Kielimalli"
              >
                {models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={config.model}
                onChange={(e) => llm.setConfig({ model: e.target.value })}
                placeholder="esim. llama3.2:3b"
                aria-label="Kielimalli"
              />
            )}
          </label>
          <button type="button" onClick={() => void llm.refreshModels()} data-testid="llm-connect">
            Hae mallit
          </button>
        </div>
        {modelsError && <p className="issue issue--error">{modelsError}</p>}
        {error && (
          <p className="issue issue--error" data-testid="llm-error">
            {error}
          </p>
        )}

        <div className="llm__row">
          <button
            type="button"
            className="btn-primary"
            disabled={!!running || !config.model.trim() || !source.text.trim()}
            onClick={() => void llm.runOnSource(source.id, source.text)}
            data-testid="llm-run"
          >
            Aja kielimallilla
          </button>
          <button
            type="button"
            disabled={!!running || !config.model.trim()}
            onClick={() => void llm.runBenchmark()}
            data-testid="llm-benchmark"
            title="Ajaa mallin 12 testitekstin läpi ja vertaa sääntöihin"
          >
            Mittaa aineistolla
          </button>
          {running && (
            <>
              <span role="status" data-testid="llm-progress">
                {running.label} ({running.done}/{running.total})
              </span>
              <button type="button" className="linklike" onClick={() => llm.cancel()}>
                Peru
              </button>
            </>
          )}
        </div>

        {valid && (
          <div className="llm__result" data-testid="llm-result">
            <div
              className="segmented segmented--compact"
              role="radiogroup"
              aria-label="Ehdotusten lähde"
            >
              {(['rules', 'llm'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={mode === m}
                  className={mode === m ? 'is-on' : ''}
                  onClick={() => llm.setMode(source.id, m)}
                >
                  {m === 'rules' ? 'Säännöt' : `Kielimalli (${result.suggestions.length})`}
                </button>
              ))}
            </div>
            <p className="field__hint">
              {result.model}: {result.suggestions.length} ehdotusta, {result.rejected} hylätty (ei
              löytynyt tekstistä), {(result.ms / 1000).toFixed(1)} s.
            </p>
          </div>
        )}

        {benchmark && (
          <div className="llm__bench" data-testid="llm-bench">
            <table className="atable">
              <caption className="sr-only">Mittaustulokset</caption>
              <thead>
                <tr>
                  <th scope="col">Dokumentti</th>
                  <th scope="col">Säännöt (R / P)</th>
                  <th scope="col">{benchmark.model} (R / P)</th>
                </tr>
              </thead>
              <tbody>
                {benchmark.rules.docs.map((d, i) => (
                  <tr key={d.id}>
                    <th scope="row">{d.title}</th>
                    <td>
                      {pct(d.recall)} / {pct(d.precision)}
                    </td>
                    <td>
                      {pct(benchmark.llm.docs[i].recall)} / {pct(benchmark.llm.docs[i].precision)}
                    </td>
                  </tr>
                ))}
                <tr className="atable__sum">
                  <th scope="row">Keskiarvo (F1)</th>
                  <td>{pct(benchmark.rules.f1)}</td>
                  <td>{pct(benchmark.llm.f1)}</td>
                </tr>
              </tbody>
            </table>
            <p className="field__hint" data-testid="llm-verdict">
              {benchmark.llm.f1 > benchmark.rules.f1 + 0.03
                ? 'Kielimalli on tällä aineistolla selvästi sääntöjä parempi.'
                : benchmark.llm.f1 < benchmark.rules.f1 - 0.03
                  ? 'Säännöt ovat tällä aineistolla kielimallia parempia. Kielimallista ei ole tässä hyötyä.'
                  : 'Ero on pieni. Säännöt riittävät, ja ne ovat nopeampia ja ennustettavampia.'}{' '}
              R = löydetyt odotetuista, P = oikeiden osuus ehdotuksista. Aineisto on kirjoitettu
              sääntöjen kehityksen rinnalla, joten sääntöjen luvut ovat optimistisia: kokeile mallia
              myös omilla teksteilläsi.
            </p>
          </div>
        )}
      </div>
    </details>
  )
}
