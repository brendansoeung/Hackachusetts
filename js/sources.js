// Citations used across the app. Every recommendation points at one of these keys.
// Only sources that were checked during the build are listed here.

export const SOURCES = Object.freeze({
  issn: {
    short: 'ISSN position stand, 2025',
    full: 'Ricci AA, et al. International Society of Sports Nutrition position stand: nutrition and weight cut strategies for mixed martial arts and other combat sports. J Int Soc Sports Nutr. 2025;22(1):2467909.',
    url: 'https://doi.org/10.1080/15502783.2025.2467909',
  },
  reale: {
    short: 'Reale et al., 2018 (water loading study)',
    full: 'Reale R, Slater G, Cox GR, Dunican IC, Burke LM. The effect of water loading on acute weight loss following fluid restriction in combat sports athletes. Int J Sport Nutr Exerc Metab. 2018;28(6):565-573.',
    url: 'https://doi.org/10.1123/ijsnem.2017-0183',
  },
  nfhs: {
    short: 'NFHS Sports Medicine Advisory Committee',
    full: 'National Federation of State High School Associations. Rules in place to guard against weight cutting in wrestling. NFHS.org, 2022.',
    url: 'https://www.nfhs.org/articles/rules-in-place-to-guard-against-weight-cutting-in-wrestling',
  },
  cdc1998: {
    short: 'CDC MMWR, 1998',
    full: 'Centers for Disease Control and Prevention. Hyperthermia and dehydration-related deaths associated with intentional rapid weight loss in three collegiate wrestlers, November-December 1997. MMWR. 1998;47(6):105-108.',
    url: 'https://pubmed.ncbi.nlm.nih.gov/9480411/',
  },
  nata: {
    short: 'NATA fluid replacement statement, 2017',
    full: "McDermott BP, et al. National Athletic Trainers' Association position statement: fluid replacement for the physically active. J Athl Train. 2017;52(9):877-895.",
    url: 'https://doi.org/10.4085/1062-6050-52.9.02',
  },
  medline: {
    short: 'MedlinePlus (NIH): bulimia',
    full: 'U.S. National Library of Medicine. Bulimia. MedlinePlus Medical Encyclopedia.',
    url: 'https://medlineplus.gov/ency/article/000341.htm',
  },
  whoop: {
    short: 'WHOOP developer API',
    full: 'WHOOP Developer Platform API (OpenAPI spec): recovery, sleep and cycle data models.',
    url: 'https://api.prod.whoop.com/developer/doc/openapi.json',
  },
  mw: {
    short: 'MakeWeight guideline',
    full: "MakeWeight's own rule, set by the founder (a former state-placing high school wrestler) to stay on the safe side of the research.",
    url: null,
  },
});

/** Looks up a list of source keys, skipping unknown ones. */
export function sourcesFor(keys) {
  return [...new Set(keys || [])].map((k) => ({ key: k, ...SOURCES[k] })).filter((s) => s.short);
}
