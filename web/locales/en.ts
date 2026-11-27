import { enBase } from './en-base.js';
import { enVault } from './en-vault.js';
import { enRules } from './en-rules.js';
import { enWorkspace } from './en-workspace.js';
import { enExchange } from './en-exchange.js';
import { enSession } from './en-session.js';
import { enOnboarding } from './en-onboarding.js';

export const en = {
  ...enBase,
  ...enVault,
  ...enRules,
  ...enWorkspace,
  ...enExchange,
  ...enSession,
  ...enOnboarding,
};

export default en;
