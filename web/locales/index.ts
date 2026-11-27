import { ru } from './ru.js';
import { en } from './en.js';
import { ruBase } from './ru-base.js';
import { ruWorkspace } from './ru-workspace.js';
import { ruExchange } from './ru-exchange.js';
import { ruVault } from './ru-vault.js';
import { ruRules } from './ru-rules.js';
import { enBase } from './en-base.js';
import { enWorkspace } from './en-workspace.js';
import { enExchange } from './en-exchange.js';
import { enVault } from './en-vault.js';
import { enRules } from './en-rules.js';

export type LocaleCode = 'ru' | 'en';
export type TranslationDictionary = Record<string, unknown>;

export {
  ru,
  en,
  ruBase,
  ruWorkspace,
  ruExchange,
  ruVault,
  ruRules,
  enBase,
  enWorkspace,
  enExchange,
  enVault,
  enRules,
};

export default { ru, en };
