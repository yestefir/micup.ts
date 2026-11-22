import { format } from 'node:util';

export type LocalizedMessages = Readonly<Record<string, Readonly<Record<string, string>>>>;

export function normalizeLocale(locale: string): string {
  return locale.trim().replaceAll('_', '-').toLowerCase();
}

export function isLocaleTag(locale: string): boolean {
  return /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(normalizeLocale(locale));
}

export class MessageCatalog {
  readonly #byLocale = new Map<string, ReadonlyMap<string, string>>();
  readonly #normalized = new Map<string, string>();
  readonly #fallback: string;

  constructor(fallback: string, messages: LocalizedMessages) {
    for (const [locale, translations] of Object.entries(messages)) {
      const equivalent = normalizeLocale(locale);
      if (!isLocaleTag(locale) || this.#normalized.has(equivalent)) throw new TypeError('Invalid or duplicate locale: ' + locale);
      this.#normalized.set(equivalent, locale);
      this.#byLocale.set(locale, new Map(Object.entries(translations)));
    }
    const baseLocale = this.#normalized.get(normalizeLocale(fallback));
    const base = this.#byLocale.get(baseLocale ?? '');
    if (!baseLocale || !base) throw new TypeError('Fallback locale has no messages');
    for (const translations of this.#byLocale.values()) {
      for (const key of translations.keys()) {
        if (!base.has(key)) throw new TypeError('Message does not appear in the fallback locale: ' + key);
      }
    }
    this.#fallback = baseLocale;
  }

  has(key: string): boolean {
    return this.#byLocale.get(this.#fallback)?.has(key) ?? false;
  }

  resolve(locale: string | undefined): string | undefined {
    const normalized = normalizeLocale(locale ?? '');
    if (!normalized) return undefined;
    const [language] = normalized.split('-');
    return this.#normalized.get(normalized) ?? this.#normalized.get(language) ??
      this.locales.find((candidate) => normalizeLocale(candidate).startsWith(language + '-'));
  }

  get fallback(): string {
    return this.#fallback;
  }

  get locales(): string[] {
    return [...this.#byLocale.keys()].sort();
  }

  textIn(locale: string | undefined, key: string, ...values: unknown[]): string {
    const preferred = this.resolve(locale);
    const text = this.#byLocale.get(preferred ?? '')?.get(key) ?? this.#byLocale.get(this.#fallback)?.get(key) ?? key;
    return values.length ? format(text, ...values) : text;
  }

  text(interaction: { locale?: string; guild_locale?: string }, key: string, ...values: unknown[]): string {
    return this.textIn(interaction.locale || interaction.guild_locale, key, ...values);
  }

  localizations(key: string): Record<string, string> {
    return Object.fromEntries(this.locales.flatMap((locale) => {
      const text = this.#byLocale.get(locale)?.get(key);
      return locale !== this.#fallback && text !== undefined ? [[locale, text]] : [];
    }));
  }
}
