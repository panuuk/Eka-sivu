/** Esimerkkiteksti pikasyötteen ohjeeseen. */
export const EXAMPLE_TEXT = `# Tilauksen käsittely
- Vastaanota tilaus @Myynti [CRM] > Tilaus
- Tarkista luottotiedot @Talous
? Ylittyykö luottoraja
  kyllä: Pyydä ennakkomaksu @Talous
  ei: jatka
- Lähetä tilausvahvistus @Myynti [Sähköposti] ~arvaus
+ Toimitus @Logistiikka
  - Keräile tuotteet [Varastojärjestelmä]
  - Lähetä paketti`

export const SYNTAX_HELP: { syntax: string; meaning: string }[] = [
  { syntax: '- Vaihe', meaning: 'Vaihe. Numeroidut listat ja * toimivat myös.' },
  { syntax: '@Rooli  @(Monisanainen rooli)', meaning: 'Vastuuhenkilö tai -taho' },
  { syntax: '[CRM, ERP]', meaning: 'Käytetyt järjestelmät' },
  { syntax: '< Syöte   > Tuotos', meaning: 'Mitä tarvitaan ja mitä syntyy (pilkulla useita)' },
  { syntax: '~arvaus  ~vahvistettu', meaning: 'Varmuus (oletus: todennäköinen)' },
  {
    syntax: '=2 pv  ^1-3 pv',
    meaning: 'Työaika (=) ja odotusaika (^): min, h, pv, vk; väli 1-3 pv',
  },
  { syntax: '%viikoittain  #tunniste', meaning: 'Toistuvuus ja tunnisteet' },
  {
    syntax: '!3 Ongelma => Idea',
    meaning: 'Kipupiste ja parannusidea. Vakavuus 1-3 (oletus 2).',
  },
  {
    syntax: 'A@Rooli  C@Rooli  I@Rooli',
    meaning: 'RACI: vastuullinen, konsultoitava, informoitava',
  },
  {
    syntax: 'Uusi nimi (aiemmin: Vanha nimi)',
    meaning: 'Vaiheen nimenmuutos: päivittää olemassa olevan vaiheen nimen eikä luo uutta',
  },
  { syntax: '? Kysymys', meaning: 'Päätös. Haarat sisennettynä muodossa "kyllä: Vaihe".' },
  {
    syntax: 'ei: jatka | loppu | -> Vaihe',
    meaning: 'Haara jatkaa, päättyy tai palaa tiettyyn vaiheeseen',
  },
  { syntax: '+ Alaprosessi', meaning: 'Alaprosessi, jonka vaiheet ovat sisennettynä' },
  {
    syntax: 'alku / loppu  alku: Nimi',
    meaning: 'Alku- ja loppupiste (lisätään itse, jos puuttuvat)',
  },
  { syntax: '---', meaning: 'Erotin: seuraava ketju ei jatka edellistä' },
  { syntax: '// kommentti', meaning: 'Rivi ohitetaan' },
]
