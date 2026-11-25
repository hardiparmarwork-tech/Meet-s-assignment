import type { UnitKind } from "../types";

/**
 * The curated, verified mapping surface. A claim can only become live if it matches one of these
 * concepts. The providers hold many more indicators; those are deliberately not auto-mapped,
 * because a title-similarity match is not evidence that two things measure the same concept.
 */
export interface Indicator {
  id: string;
  provider: "World Bank" | "Our World in Data";
  code: string;
  /** OWID short column name. */
  column?: string;
  name: string;
  definition: string;
  unit: UnitKind;
  /** Substring that must appear in the provider's unit/title; guards against silent redefinition. */
  unitGuard: string;
  methodology: string;
}

const wb = (code: string, name: string, unit: UnitKind, unitGuard: string, definition: string, methodology = "World Development Indicators compilation of national and international sources."): Indicator =>
  ({ id: `wb:${code}`, provider: "World Bank", code, name, unit, unitGuard, definition, methodology });

export const INDICATORS: Indicator[] = [
  wb("SP.POP.TOTL", "Population, total", "people", "Population, total", "Mid-year count of all residents regardless of legal status."),
  wb("SP.DYN.LE00.IN", "Life expectancy at birth, total", "years", "(years)", "Years a newborn would live if mortality patterns at birth stayed the same.", "Period life expectancy; largely modelled estimates (UN WPP and national sources)."),
  wb("SP.DYN.LE00.FE.IN", "Life expectancy at birth, female", "years", "(years)", "Period life expectancy at birth for females.", "Modelled estimates."),
  wb("SP.DYN.LE00.MA.IN", "Life expectancy at birth, male", "years", "(years)", "Period life expectancy at birth for males.", "Modelled estimates."),
  wb("SP.DYN.IMRT.IN", "Infant mortality rate", "per_1000_births", "per 1,000 live births", "Deaths before age one per 1,000 live births.", "UN IGME modelled estimates; may differ from national survey estimates."),
  wb("SH.DYN.MORT", "Under-5 mortality rate", "per_1000_births", "per 1,000 live births", "Probability of dying before age five, per 1,000 live births.", "UN IGME modelled estimates; may differ from national survey estimates."),
  wb("SH.STA.MMRT", "Maternal mortality ratio (modelled)", "per_100000_births", "per 100,000 live births", "Maternal deaths per 100,000 live births.", "WHO/UN inter-agency modelled estimates."),
  wb("SP.DYN.TFRT.IN", "Total fertility rate", "births_per_woman", "births per woman", "Births per woman at current age-specific fertility rates."),
  wb("SP.URB.TOTL.IN.ZS", "Urban population share", "percent", "% of total population", "People living in urban areas as a share of total population.", "National definitions of 'urban' differ."),
  wb("SP.POP.GROW", "Population growth, annual", "percent", "annual %", "Annual population growth rate."),
  wb("NY.GDP.MKTP.CD", "GDP (current US$)", "usd", "current US$", "Gross domestic product at current prices in US dollars.", "National accounts; subject to rebasing and revision."),
  wb("NY.GDP.PCAP.CD", "GDP per capita (current US$)", "usd_per_person", "current US$", "GDP divided by mid-year population, current US dollars.", "National accounts; subject to revision."),
  wb("NY.GDP.PCAP.KD", "GDP per capita (constant 2015 US$)", "usd_per_person", "constant 2015 US$", "GDP per capita at constant 2015 US dollars.", "National accounts; subject to revision."),
  wb("NY.GDP.PCAP.PP.CD", "GDP per capita, PPP (current international $)", "intl_usd_per_person", "current international $", "GDP per capita converted using purchasing power parity.", "Depends on ICP price rounds."),
  wb("NY.GDP.MKTP.KD.ZG", "GDP growth, annual", "percent", "annual %", "Annual growth of GDP at constant prices.", "National accounts; often revised."),
  wb("FP.CPI.TOTL.ZG", "Inflation, consumer prices", "percent", "annual %", "Annual change in the consumer price index.", "Calendar-year average; national fiscal-year figures differ."),
  wb("SL.UEM.TOTL.ZS", "Unemployment rate (modelled ILO estimate)", "percent", "% of total labor force", "Unemployed as a share of the labour force.", "ILO modelled estimate; national survey rates use different definitions."),
  wb("SE.ADT.LITR.ZS", "Adult literacy rate", "percent", "% of people ages 15 and above", "Share of people aged 15+ who can read and write a short simple statement.", "Surveys and censuses; irregular coverage."),
  wb("SE.XPD.TOTL.GD.ZS", "Government expenditure on education", "pct_gdp", "% of GDP", "General government education spending as a share of GDP."),
  wb("SH.XPD.CHEX.GD.ZS", "Current health expenditure", "pct_gdp", "% of GDP", "Current health spending as a share of GDP.", "WHO Global Health Expenditure Database."),
  wb("EN.ATM.PM25.MC.M3", "PM2.5 exposure, national annual mean", "ug_m3", "micrograms per cubic meter", "Population-weighted national mean annual exposure to ambient PM2.5.", "Modelled from satellite, simulation and ground monitoring data; not comparable with a single station or city reading."),
  wb("EN.GHG.CO2.PC.CE.AR5", "CO2 emissions per capita, excl. LULUCF (EDGAR)", "t_per_person", "t CO2e/capita", "Territorial CO2 emissions excluding land use change, per person.", "EDGAR inventory."),
  wb("EG.ELC.ACCS.ZS", "Access to electricity", "percent", "% of population", "Share of population with access to electricity.", "Household surveys and modelling."),
  wb("EG.FEC.RNEW.ZS", "Renewable energy share of final consumption", "percent", "% of total final energy consumption", "Renewables as a share of total final energy consumption (not of electricity)."),
  wb("AG.LND.FRST.ZS", "Forest area share", "percent", "% of land area", "Forest area as a share of land area.", "FAO definitions of forest."),
  wb("AG.LND.AGRI.ZS", "Agricultural land share", "percent", "% of land area", "Agricultural land as a share of land area."),
  wb("AG.YLD.CREL.KG", "Cereal yield", "kg_per_ha", "kg per hectare", "Cereal production per harvested hectare."),
  wb("SH.H2O.BASW.ZS", "At least basic drinking water services", "percent", "% of population", "Share of population using at least basic drinking water services.", "WHO/UNICEF JMP estimates."),
  wb("IT.NET.USER.ZS", "Individuals using the Internet", "percent", "% of population", "Share of population who used the Internet recently.", "ITU estimates; age scope varies by survey."),
  wb("SI.POV.DDAY", "Poverty headcount at $3.00/day (2021 PPP)", "percent", "$3.00 a day (2021 PPP)", "Share of population below $3.00 a day in 2021 PPP.", "Household surveys; poverty line definitions change over time."),
  { id: "owid:co-emissions-per-capita", provider: "Our World in Data", code: "co-emissions-per-capita", column: "emissions_total_per_capita", name: "CO2 emissions per capita (fossil and industry)", unit: "t_per_person", unitGuard: "tonnes per person", definition: "Fossil and industrial CO2 emissions per person; excludes land use change.", methodology: "Global Carbon Budget, processed by Our World in Data." },
  { id: "owid:annual-co2-emissions-per-country", provider: "Our World in Data", code: "annual-co2-emissions-per-country", column: "emissions_total", name: "Annual CO2 emissions (fossil and industry)", unit: "tonnes", unitGuard: "tonnes", definition: "Territorial fossil and industrial CO2 emissions; excludes land use change.", methodology: "Global Carbon Budget, processed by Our World in Data." },
];

export const indicator = (id: string): Indicator => {
  const found = INDICATORS.find((i) => i.id === id);
  if (!found) throw new Error(`Unknown indicator ${id}`);
  return found;
};

export interface Concept {
  id: string;
  label: string;
  domain: string;
  match: RegExp;
  /** If present in the same clause, the claim is about something else. */
  mismatch?: { pattern: RegExp; reason: string }[];
  /** More than one id means more than one defensible source; both are tested. */
  indicators: string[];
  /** Narrows the candidates from wording in the sentence. */
  narrow?: { pattern: RegExp; keep: string[] }[];
}

const c = (id: string, label: string, domain: string, match: RegExp, indicators: string[], extra: Partial<Concept> = {}): Concept =>
  ({ id, label, domain, match, indicators, ...extra });

const AT_AGE = { pattern: /\bat (the )?age (of )?\d+|\bat age\b|healthy life expectancy|\bHALE\b/i, reason: "Healthy or age-conditional life expectancy is a different measure from life expectancy at birth." };

export const CONCEPTS: Concept[] = [
  c("life-female", "Life expectancy at birth, female", "Public health", /\b(female|women'?s) life expectancy|life expectancy (at birth )?(for|of|among) (women|females)/i, ["wb:SP.DYN.LE00.FE.IN"], { mismatch: [AT_AGE] }),
  c("life-male", "Life expectancy at birth, male", "Public health", /\b(male|men'?s) life expectancy|life expectancy (at birth )?(for|of|among) (men|males)\b/i, ["wb:SP.DYN.LE00.MA.IN"], { mismatch: [AT_AGE] }),
  c("life", "Life expectancy at birth", "Public health", /life expectancy/i, ["wb:SP.DYN.LE00.IN"], { mismatch: [AT_AGE] }),
  c("infant", "Infant mortality rate", "Public health", /infant mortality/i, ["wb:SP.DYN.IMRT.IN"], { mismatch: [{ pattern: /neonatal/i, reason: "Neonatal mortality is a different measure." }] }),
  c("under5", "Under-5 mortality rate", "Public health", /under[- ](5|five)[- ]?(year[- ]old )?(child )?mortality|child mortality rate/i, ["wb:SH.DYN.MORT"]),
  c("maternal", "Maternal mortality ratio", "Public health", /maternal mortality/i, ["wb:SH.STA.MMRT"]),
  c("fertility", "Total fertility rate", "Demography", /(total )?fertility rate/i, ["wb:SP.DYN.TFRT.IN"], { mismatch: [{ pattern: /adolescent|age[- ]specific|replacement/i, reason: "Adolescent, age-specific or replacement fertility is a different measure." }] }),
  c("urban", "Urban population share", "Demography", /urban population|urbani[sz]ation (rate|level)|(population|people)[^.]{0,30}(lived?|living|resided?|residing) in (urban areas|cities)/i, ["wb:SP.URB.TOTL.IN.ZS"]),
  c("popgrowth", "Population growth rate", "Demography", /population growth( rate)?/i, ["wb:SP.POP.GROW"]),
  c("gdppc", "GDP per capita", "Economics", /(gdp|gross domestic product) per (capita|person)|per[- ]capita (gdp|gross domestic product)/i, ["wb:NY.GDP.PCAP.CD", "wb:NY.GDP.PCAP.KD", "wb:NY.GDP.PCAP.PP.CD"], {
    narrow: [
      { pattern: /\bPPP\b|purchasing power|international dollar/i, keep: ["wb:NY.GDP.PCAP.PP.CD"] },
      { pattern: /constant|real (gdp|per[- ]capita)|2015 (US )?dollars/i, keep: ["wb:NY.GDP.PCAP.KD"] },
      { pattern: /current (US ?\$|US dollars|dollars|prices)|nominal/i, keep: ["wb:NY.GDP.PCAP.CD"] },
    ],
    mismatch: [{ pattern: /per[- ]capita (income|consumption)|growth/i, reason: "Per-capita growth or income is a different measure from the GDP per capita level." }],
  }),
  c("gdpgrowth", "GDP growth rate", "Economics", /(gdp|gross domestic product|economic) growth( rate)?|(gdp|economy) grew/i, ["wb:NY.GDP.MKTP.KD.ZG"], { mismatch: [{ pattern: /per[- ]capita|per person|nominal|quarter/i, reason: "Per-capita, nominal or quarterly growth differs from annual real GDP growth." }] }),
  c("gdp", "Gross domestic product", "Economics", /\bGDP\b|gross domestic product/i, ["wb:NY.GDP.MKTP.CD"], { mismatch: [{ pattern: /constant|real gdp|\bPPP\b|purchasing power|per[- ](capita|person)|growth/i, reason: "Only total GDP in current US$ is supported by this concept." }] }),
  c("inflation", "Consumer price inflation", "Economics", /inflation( rate)?/i, ["wb:FP.CPI.TOTL.ZG"], { mismatch: [{ pattern: /food|core|wholesale|monthly|month[- ]on[- ]month|quarter/i, reason: "Food, core, wholesale or sub-annual inflation is a different measure." }] }),
  c("unemployment", "Unemployment rate", "Economics", /unemployment( rate)?/i, ["wb:SL.UEM.TOTL.ZS"], { mismatch: [{ pattern: /youth|graduate|female|women|male\b|monthly|quarter/i, reason: "A subgroup or sub-annual unemployment rate differs from the total annual rate." }] }),
  c("literacy", "Adult literacy rate", "Education", /(adult )?literacy( rate)?/i, ["wb:SE.ADT.LITR.ZS"], { mismatch: [{ pattern: /youth|female|women|male\b|digital|health literacy|financial/i, reason: "A subgroup or different literacy concept is not the total adult literacy rate." }] }),
  c("eduspend", "Government education expenditure", "Education", /(government|public) (expenditure|spending) on education|education (expenditure|spending)/i, ["wb:SE.XPD.TOTL.GD.ZS"]),
  c("healthspend", "Current health expenditure", "Public health", /health (expenditure|spending)|(expenditure|spending) on health/i, ["wb:SH.XPD.CHEX.GD.ZS"], { mismatch: [{ pattern: /(government|public|out[- ]of[- ]pocket|private)/i, reason: "Government, private or out-of-pocket spending is only part of current health expenditure." }] }),
  c("pm25", "PM2.5 exposure", "Environment", /PM\s?2\.5|fine particulate/i, ["wb:EN.ATM.PM25.MC.M3"], { mismatch: [{ pattern: /guideline|standard|threshold|limit value|interim target/i, reason: "A guideline or legal threshold is a fixed reference value." }, { pattern: /daily|24[- ]hour|hourly|monthly|peak|station|monitor|indoor|household|winter|summer/i, reason: "The national annual population-weighted mean is not comparable with daily, seasonal, station or indoor readings." }] }),
  c("co2pc", "CO2 emissions per capita", "Climate", /(CO2|CO₂|carbon dioxide)[^.;]{0,30}(per[- ]capita|per person)|per[- ]capita[^.;]{0,30}(CO2|CO₂|carbon dioxide)/i, ["owid:co-emissions-per-capita", "wb:EN.GHG.CO2.PC.CE.AR5"], { mismatch: [{ pattern: /consumption[- ]based|greenhouse gas|including land|LULUCF included/i, reason: "Consumption-based, all-GHG or land-use-inclusive emissions are different measures." }] }),
  c("co2", "Annual CO2 emissions", "Climate", /(CO2|CO₂|carbon dioxide) emissions/i, ["owid:annual-co2-emissions-per-country"], { mismatch: [{ pattern: /cumulative|consumption[- ]based|greenhouse|sector|transport|power plant|per (unit|km|kilowatt)/i, reason: "Cumulative, sectoral, intensity or consumption-based emissions are different measures." }] }),
  c("electricity", "Access to electricity", "Energy", /access to electricity|electricity access/i, ["wb:EG.ELC.ACCS.ZS"]),
  c("renewable", "Renewable energy share", "Energy", /renewable(s| energy)/i, ["wb:EG.FEC.RNEW.ZS"], { mismatch: [{ pattern: /electricity|power generation|capacity/i, reason: "The mapped indicator is the share of final energy consumption, not of electricity or capacity." }] }),
  c("forest", "Forest area share", "Environment", /forest (area|cover)/i, ["wb:AG.LND.FRST.ZS"]),
  c("agland", "Agricultural land share", "Agriculture", /agricultural land/i, ["wb:AG.LND.AGRI.ZS"]),
  c("cereal", "Cereal yield", "Agriculture", /cereal yields?/i, ["wb:AG.YLD.CREL.KG"]),
  c("water", "Basic drinking water services", "Public health", /basic drinking[- ]water/i, ["wb:SH.H2O.BASW.ZS"]),
  c("internet", "Internet use", "Development", /(using|use[ds]?) (of )?the internet|internet (users|use|penetration)/i, ["wb:IT.NET.USER.ZS"]),
  c("poverty", "Extreme poverty headcount", "Economics", /poverty (headcount|rate)|extreme poverty|below the (international )?poverty line/i, ["wb:SI.POV.DDAY"], { mismatch: [{ pattern: /\$\s?(1\.25|1\.90|2\.15|3\.65|4\.20|6\.85|8\.30)|national poverty line|multidimensional/i, reason: "A different poverty line or poverty definition is not comparable with the $3.00/day (2021 PPP) headcount." }] }),
  // Deliberately after "urban": a bare population count.
  c("population", "Total population", "Demography", /\bpopulation\b|\binhabitants\b/i, ["wb:SP.POP.TOTL"], { mismatch: [{ pattern: /urban|rural|growth|sample|study population|target population|aged|working[- ]age|school|child|elderly|density/i, reason: "A subgroup, growth rate, density or study population is not the total population." }] }),
];
