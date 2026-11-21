/**
 * Arviointiaineisto: realistinen suomenkielinen prosessikuvaus ja siitä odotetut vaiheet.
 * Käytetään sääntömoottorin laadun mittaamiseen (ja myöhemmin kielimallin vertailuun).
 */
export const REKRYTOINTI_TEKSTI = `Rekrytointiprosessi

Rekrytointi alkaa, kun esimies tunnistaa tarpeen uudelle työntekijälle. Esimies täyttää rekrytointipyynnön Rekrysysteemissä ja perustelee tehtävän tarpeen. HR-asiantuntija tarkistaa pyynnön ja varmistaa, että tehtävälle on budjetoitu rahoitus. Jos rahoitusta ei ole, pyyntö palautetaan esimiehelle ja prosessi päättyy. Rahoitetun pyynnön hyväksyy talousjohtaja.

Hyväksymisen jälkeen HR-asiantuntija laatii työpaikkailmoituksen yhdessä esimiehen kanssa. Esimies tarkistaa ilmoituksen sisällön ja hyväksyy sen. HR-asiantuntija julkaisee ilmoituksen yrityksen verkkosivuilla ja Rekrysysteemissä. Tarvittaessa ilmoitus julkaistaan myös ulkoisissa kanavissa, jolloin viestintä päivittää ilmoituksen sosiaaliseen mediaan.

Hakuaika on yleensä kaksi viikkoa. Hakemukset tallentuvat automaattisesti Rekrysysteemiin. HR-asiantuntija lähettää hakijalle vahvistuksen hakemuksen vastaanottamisesta. Hakuajan päätyttyä HR-asiantuntija koostaa hakijayhteenvedon esimiehelle.

Esimies arvioi hakemukset ja valitsee haastateltavat. Jos päteviä hakijoita on alle kolme, hakuaikaa jatketaan. HR-asiantuntija sopii haastatteluajat hakijoiden kanssa ja lähettää kutsut sähköpostilla. Ensimmäisen haastattelun pitävät esimies ja HR-asiantuntija yhdessä. Haastattelun jälkeen kumpikin kirjaa arvionsa Rekrysysteemiin.

Parhaat hakijat kutsutaan toiselle haastattelulle, jossa on mukana myös tiimin edustaja. Tarvittaessa hakijat tekevät soveltuvuusarvioinnin. HR-asiantuntija tilaa arvioinnin ulkoiselta palveluntuottajalta ja saa tulokset sähköpostilla.

Esimies tekee valintapäätöksen haastattelujen ja arviointien perusteella. Valinnan vahvistaa talousjohtaja. Jos valittu hakija ei ole saatavilla, esimies palaa seuraavaksi parhaaseen hakijaan. HR-asiantuntija ottaa yhteyttä valittuun hakijaan ja tekee suullisen tarjouksen. Jos hakija hyväksyy tarjouksen, HR-asiantuntija laatii työsopimuksen ja lähettää sen allekirjoitettavaksi.

Kun työsopimus on allekirjoitettu, HR-asiantuntija ilmoittaa valitsemattomille hakijoille kielteisestä päätöksestä. Palkka-asiantuntija perustaa työntekijän tiedot palkanlaskentajärjestelmään. IT-tuki luo käyttäjätunnukset ja tilaa työvälineet. Esimies suunnittelee perehdytyksen ensimmäiselle viikolle. Uusi työntekijä aloittaa työnsä sovittuna päivänä, ja HR-asiantuntija pitää perehdytyspäivän. Lopuksi esimies arvioi koeajan kuluttua työntekijän sopivuuden ja kirjaa arvion.`

/** Odotetut vaiheet: jokaisella avainsanat (stemmit), jotka löytyvät oikeasta ehdotuksesta. */
export interface GoldStep {
  /** Vaiheen kuvaus ihmiselle. */
  name: string
  /** Kaikkien näiden pitää esiintyä ehdotuksen nimessä tai lainauksessa (pienillä kirjaimilla). */
  keys: string[]
  kind?: 'step' | 'decision'
}

export const REKRYTOINTI_GOLD: GoldStep[] = [
  { name: 'Täytä rekrytointipyyntö', keys: ['rekrytointipyyn', 'täytt'] },
  { name: 'Tarkista pyyntö ja rahoitus', keys: ['tarkist', 'pyynn'] },
  { name: 'Onko rahoitus', keys: ['rahoitus'], kind: 'decision' },
  { name: 'Hyväksy pyyntö', keys: ['hyväksy', 'pyyn'] },
  { name: 'Laadi työpaikkailmoitus', keys: ['laati', 'ilmoitu'] },
  { name: 'Tarkista ilmoituksen sisältö', keys: ['tarkistaa', 'ilmoituksen sisäl'] },
  { name: 'Hyväksy ilmoitus', keys: ['hyväksyy', 'sen'] },
  { name: 'Perustele tarve', keys: ['perustelee'] },
  { name: 'Palauta pyyntö esimiehelle', keys: ['palautetaan', 'esimiehelle'] },
  { name: 'Tallenna hakemukset', keys: ['tallentuvat'] },
  { name: 'Jatka hakuaikaa', keys: ['hakuaikaa', 'jatketaan'] },
  { name: 'Palaa seuraavaan hakijaan', keys: ['palaa', 'hakijaan'] },
  { name: 'Ota yhteyttä hakijaan', keys: ['yhteyttä'] },
  { name: 'Tilaa työvälineet', keys: ['tilaa', 'työvälin'] },
  { name: 'Julkaise ilmoitus', keys: ['julkais', 'ilmoitu'] },
  { name: 'Päivitä ilmoitus someen', keys: ['päivit', 'ilmoitu'] },
  { name: 'Lähetä vahvistus hakijalle', keys: ['lähet', 'vahvistu'] },
  { name: 'Koosta hakijayhteenveto', keys: ['koostaa', 'hakijayhteenve'] },
  { name: 'Arvioi hakemukset', keys: ['arvioi', 'hakemu'] },
  { name: 'Valitse haastateltavat', keys: ['valits', 'haastateltav'] },
  { name: 'Riittävästi päteviä hakijoita', keys: ['hakijoita', 'alle'], kind: 'decision' },
  { name: 'Sovi haastatteluajat', keys: ['sopii', 'haastatteluaj'] },
  { name: 'Lähetä kutsut', keys: ['lähet', 'kutsu'] },
  { name: 'Pidä ensimmäinen haastattelu', keys: ['haastattelun', 'pitä'] },
  { name: 'Kirjaa arviot', keys: ['kirjaa', 'arvio'] },
  { name: 'Kutsu toiselle haastattelulle', keys: ['kutsutaan', 'haastatte'] },
  { name: 'Tee soveltuvuusarviointi', keys: ['soveltuvuusarvioin'] },
  { name: 'Tilaa arviointi', keys: ['tilaa', 'arvioin'] },
  { name: 'Tee valintapäätös', keys: ['valintapäätö'] },
  { name: 'Vahvista valinta', keys: ['vahvistaa', 'valinna'] },
  { name: 'Hakija saatavilla', keys: ['saatavilla'], kind: 'decision' },
  { name: 'Tee suullinen tarjous', keys: ['tarjou'] },
  { name: 'Hyväksyykö hakija tarjouksen', keys: ['hakija', 'hyväksyy'], kind: 'decision' },
  { name: 'Laadi työsopimus', keys: ['laati', 'työsopimu'] },
  { name: 'Ilmoita valitsemattomille', keys: ['ilmoitta', 'valitsemattom'] },
  { name: 'Perusta tiedot palkanlaskentaan', keys: ['perustaa', 'palkanlasken'] },
  { name: 'Luo käyttäjätunnukset', keys: ['luo', 'käyttäjätunnu'] },
  { name: 'Suunnittele perehdytys', keys: ['suunnittel', 'perehdy'] },
  { name: 'Pidä perehdytyspäivä', keys: ['perehdytyspäiv'] },
  { name: 'Arvioi sopivuus koeajan jälkeen', keys: ['koeajan', 'arvioi'] },
]
