/**
 * Montants : tous les prix/soldes sont stockés en unités mineures (entier),
 * ex. 100 FCFA = 100 (XOF, 0 décimale) ou 1000 centimes = 10,00 EUR (2 décimales).
 * money.ts centralise conversions et arithmétique pour éviter les erreurs de
 * virgule flottante (arrondi bancaire via Math.round sur des entiers).
 */

/** Numéros ISO 4217 -> nombre de décimales affichées. */
export const CURRENCY_DECIMALS: Record<string, number> = {
  XOF: 0, // FCFA BCEAO
  XAF: 0, // FCFA BEAC
  NGN: 2,
  GHS: 2,
  KES: 2,
  TZS: 0,
  UGX: 0,
  RWF: 0,
  MAD: 2,
  EGP: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
  CNY: 2,
  INR: 2,
};

export function decimalsFor(currency: string): number {
  return CURRENCY_DECIMALS[currency.toUpperCase()] ?? 2;
}

/** Convertit une valeur majeure (ex. 1500.75) en unité mineure arrondie. */
export function toMinor(amountMajor: number, currency: string): number {
  const d = decimalsFor(currency);
  return Math.round(amountMajor * 10 ** d);
}

/** Convertit une unité mineure en nombre majeur (affichage uniquement). */
export function toMajor(amountMinor: number, currency: string): number {
  const d = decimalsFor(currency);
  return amountMinor / 10 ** d;
}

/** Formatage d'affichage : "1 500 FCFA". */
export function formatMoney(amountMinor: number, currency: string): string {
  const major = toMajor(amountMinor, currency);
  const d = decimalsFor(currency);
  const formatted = major.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
  return `${formatted} ${currency.toUpperCase()}`;
}

/** Addition sûre en unités mineures. */
export function addMinor(a: number, b: number): number {
  return a + b;
}

/** Soustraction sûre en unités mineures. */
export function subMinor(a: number, b: number): number {
  return a - b;
}

/**
 * Pourcentage en base 10000 (ex. 8% = 800 -> part sur un total minor).
 * Arrondi au plus proche ; la somme des parts est corrigée par `remainder`
 * que l'appelant peut attribuer à une ligne (ex. commission).
 */
export function percentOfMinor(totalMinor: number, basisPoints: number): number {
  return Math.round((totalMinor * basisPoints) / 10000);
}

/** Calcule le montant net après commission (en minor units). */
export function afterCommission(totalMinor: number, commissionPercent: number): { gross: number; fee: number; net: number } {
  const fee = percentOfMinor(totalMinor, Math.round(commissionPercent * 100));
  return { gross: totalMinor, fee, net: totalMinor - fee };
}

export function isPositiveMinor(amountMinor: number): boolean {
  return Number.isInteger(amountMinor) && amountMinor > 0;
}
