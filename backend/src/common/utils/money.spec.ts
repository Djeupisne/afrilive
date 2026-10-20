import {
  CURRENCY_EXPONENTS,
  addMinor,
  applyPercentMinor,
  exponentOf,
  formatMoney,
  fromMinor,
  toMinor,
} from './money';

describe('money — unités mineures (jamais de flottants)', () => {
  describe('exposants ISO 4217', () => {
    it('0 décimale : XOF / XAF / GNF / JPY', () => {
      expect(exponentOf('XOF')).toBe(0);
      expect(exponentOf('XAF')).toBe(0);
      expect(exponentOf('GNF')).toBe(0);
      expect(exponentOf('JPY')).toBe(0);
    });
    it('2 décimales : EUR / USD / NGN / GHS', () => {
      expect(exponentOf('EUR')).toBe(2);
      expect(exponentOf('usd')).toBe(2); // insensible à la casse
      expect(exponentOf('NGN')).toBe(2);
      expect(exponentOf('GHS')).toBe(2);
    });
    it('3 décimales : TND / LYD', () => {
      expect(exponentOf('TND')).toBe(3);
      expect(exponentOf('LYD')).toBe(3);
    });
    it('devise inconnue → erreur explicite', () => {
      expect(() => exponentOf('XTS')).toThrow(/Devise inconnue/);
    });
    it('la table couvre les devises du cahier des charges', () => {
      for (const c of ['XOF', 'GHS', 'NGN', 'KES', 'TND', 'EUR', 'USD']) {
        expect(CURRENCY_EXPONENTS[c]).toBeDefined();
      }
    });
  });

  describe('toMinor', () => {
    it('XOF : pas de décimale (arrondi half-up)', () => {
      expect(toMinor('1500', 'XOF')).toBe(1500);
      expect(toMinor(1500.4, 'XOF')).toBe(1500); // 1500.4 → 1500
      expect(toMinor('1500.5', 'XOF')).toBe(1501); // demi → vers le haut
      expect(toMinor('-2.5', 'XOF')).toBe(-3); // symétrique sur la valeur absolue
    });
    it('EUR : centimes exacts', () => {
      expect(toMinor('1500.75', 'EUR')).toBe(150075);
      expect(toMinor('0.01', 'EUR')).toBe(1);
      expect(toMinor('19.99', 'EUR')).toBe(1999);
    });
    it('TND : millimes (3 décimales)', () => {
      expect(toMinor('1.234', 'TND')).toBe(1234);
      expect(toMinor('10', 'TND')).toBe(10000);
    });
    it('pas d’artefact de flottant sur les montants classiques', () => {
      // 8.20 * 100 en float binaire = 819.999… ; le résultat doit rester un entier exact
      expect(Number.isInteger(toMinor('8.20', 'EUR'))).toBe(true);
      expect(toMinor('8.20', 'EUR')).toBe(820);
      expect(toMinor('114.79', 'USD')).toBe(11479);
      expect(() => toMinor('abc', 'EUR')).toThrow(/Montant invalide/);
    });
  });

  describe('fromMinor — chaîne décimale exacte', () => {
    it('XOF : entier sans point', () => {
      expect(fromMinor(1500, 'XOF')).toBe('1500');
      expect(fromMinor(-1500, 'XOF')).toBe('-1500');
    });
    it('EUR : deux décimales, padding à gauche', () => {
      expect(fromMinor(150075, 'EUR')).toBe('1500.75');
      expect(fromMinor(5, 'EUR')).toBe('0.05');
      expect(fromMinor(50, 'EUR')).toBe('0.50');
    });
    it('TND : trois décimales', () => {
      expect(fromMinor(1234, 'TND')).toBe('1.234');
      expect(fromMinor(7, 'TND')).toBe('0.007');
    });
    it('aller-retour stable sur tous les ordres de grandeur', () => {
      for (const minor of [0, 1, 99, 100, 999999999, 123456789012]) {
        expect(toMinor(fromMinor(minor, 'EUR'), 'EUR')).toBe(minor);
      }
    });
    it('ne renvoie jamais un float', () => {
      expect(typeof fromMinor(150075, 'EUR')).toBe('string');
    });
  });

  describe('addMinor', () => {
    it('addition exacte même devise', () => {
      expect(addMinor(1000, 2500, 'XOF', 'XOF')).toBe(3500);
      expect(addMinor(-1, 1, 'EUR', 'EUR')).toBe(0);
    });
    it('mélange de devises → erreur', () => {
      expect(() => addMinor(100, 100, 'XOF', 'EUR')).toThrow(/Mélange de devises/);
    });
  });

  describe('applyPercentMinor (bp : 800 = 8,00 %)', () => {
    it('exact quand divisible', () => {
      expect(applyPercentMinor(10000, 800)).toBe(800); // 8 % de 10 000
    });
    it('arrondi au demi-unité mineure (half-up)', () => {
      // 12345 * 8% = 987.6 → 988
      expect(applyPercentMinor(12345, 800)).toBe(988);
      // reste pile 0,5 → on arrondit vers le haut
      expect(applyPercentMinor(625, 800)).toBe(50); // 50.0 exact
      expect(applyPercentMinor(1563, 800)).toBe(125); // 125.04 → 125
    });
    it('négatifs symétriques', () => {
      expect(applyPercentMinor(-12345, 800)).toBe(-988);
    });
    it('grands montants sans perte (BigInt interne)', () => {
      // 999 999 999 999 * 8 % = 79 999 999 999.92 → 80 000 000 000
      expect(applyPercentMinor(999999999999, 800)).toBe(80000000000);
    });
    it('0 % et 100 %', () => {
      expect(applyPercentMinor(5000, 0)).toBe(0);
      expect(applyPercentMinor(5000, 10000)).toBe(5000);
    });
  });

  describe('formatMoney', () => {
    it('formate en francs CFA', () => {
      const s = formatMoney(1500, 'XOF');
      expect(s.replace(/\u00a0|\s/g, '')).toContain('1500');
    });
    it('formate les centimes (fr-FR : séparateur insécable)', () => {
      expect(formatMoney(150075, 'EUR').replace(/\u202f|\u00a0|\s/g, ' ')).toContain('1 500,75');
    });
  });
});
