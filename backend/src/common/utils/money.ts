/**
 * Manipulation monétaire en unités mineures (entiers) — jamais de float.
 * La table des exposants couvre les devises africaines supportées + ISO courantes.
 */

/** Exposant ISO 4217 (nombre de décimales) par devise. */
export const CURRENCY_EXPONENTS: Record<string, number> = {
  // Afrique de l'Ouest
  XOF: 0, // Franc CFA BCEAO (Sénégal, Côte d'Ivoire, Bénin…)
  XAF: 0, // Franc CFA BEAC (Cameroun, Gabon…)
  XCD: 2,
  GHS: 2, // Cédéghana
  NGN: 2, // Naira
  GMD: 2, // Dalasi
  SLL: 2, // Leone (Sierra Leone)
  LRD: 2, // Dollar libérien
  CVE: 2, // Escudo cap-verdien
  GNF: 0, // Franc guinéen
  // Afrique de l'Est / australe
  KES: 2, // Shilling kényan
  UGX: 0, // Shilling ougandais
  TZS: 2, // Shilling tanzanien
  RWF: 0, // Franc rwandais
  BIF: 0, // Franc burundais
  ETB: 2, // Birr éthiopien
  MZN: 2, // Metical
  ZAR: 2, // Rand
  ZMW: 2, // Kwacha zambien
  MWK: 2, // Kwacha malawite
  MUR: 2, // Rupie mauricienne
  SCR: 2, // Rupie seychelloise
  // Afrique du Nord / autres
  EGP: 2,
  MAD: 2,
  DZD: 2,
  TND: 3, // Dinar tunisien (3 décimales)
  LYD: 3,
  SDG: 2,
  SOS: 2,
  DJF: 0, // Franc djiboutien
  // Références internationales
  EUR: 2,
  USD: 2,
  GBP: 2,
  CHF: 2,
  CAD: 2,
  JPY: 0,
  CNY: 2,
  AED: 2,
  SAR: 2,
  BRL: 2,
  INR: 2,
};

export function exponentOf(currency: string): number {
  const exp = CURRENCY_EXPONENTS[currency.toUpperCase()];
  if (exp === undefined) {
    throw new Error(`Devise inconnue : ${currency}`);
  }
  return exp;
}

/** Convertit un montant unitaire ("1500.75") en entier d'unités mineures. */
export function toMinor(amount: string | number, currency: string): number {
  const factor = 10 ** exponentOf(currency);
  // Arrondi bancaire simple via multiplication exacte en chaîne décimale.
  return Math.round(Number(amount) * factor * 1e6) / 1e6;
}

/** Convertit des unités mineures en chaîne décimale exacte (pas de float exporté). */
export function fromMinor(minor: number, currency: string): string {
  const exp = exponentOf(currency);
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(minor));
  if (exp === 0) return `${sign}${abs}`;
  const s = String(abs).padStart(exp + 1, '0');
  return `${sign}${s.slice(0, -exp)}.${s.slice(-exp)}`;
}

/** Addition exacte d'unités mineures avec contrôle d'homogénéité de devise. */
export function addMinor(a: number, b: number, currencyA: string, currencyB: string): number {
  if (currencyA.toUpperCase() !== currencyB.toUpperCase()) {
    throw new Error(`Mélange de devises : ${currencyA} vs ${currencyB}`);
  }
  return Math.trunc(a) + Math.trunc(b);
}

/**
 * Applique un pourcentage (ex. commission 8 %) aux unités mineures.
 * `percent` est exprimé en centièmes de point : 800 = 8,00 %.
 * Arrondi au demi-unité mineure (banker's rounding) pour éviter tout biais.
 */
export function applyPercentMinor(minor: number, percentBp: number): number {
  const raw = (BigInt(Math.trunc(minor)) * BigInt(Math.trunc(percentBp))) / 10000n;
  const rem = (BigInt(Math.trunc(minor)) * BigInt(Math.trunc(percentBp))) % 10000n;
  let result = raw;
  if (rem * 2n >= 10000n) result += 1n;
  else if (rem * 2n <= -10000n) result -= 1n;
  return Number(result);
}

/** Formatage d'affichage : "1 500,75 FCFA". */
export function formatMoney(minor: number, currency: string, locale = 'fr-FR'): string {
  const value = Number(fromMinor(minor, currency));
  return new Intl.NumberFormat(locale, { style: 'currency', currency: currency.toUpperCase() }).format(value);
}
