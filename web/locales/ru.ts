import { ruBase } from './ru-base.js';
import { ruVault } from './ru-vault.js';
import { ruRules } from './ru-rules.js';
import { ruWorkspace } from './ru-workspace.js';
import { ruExchange } from './ru-exchange.js';
import { ruSession } from './ru-session.js';
import { ruOnboarding } from './ru-onboarding.js';

export const ru = {
  ...ruBase,
  ...ruVault,
  ...ruRules,
  ...ruWorkspace,
  ...ruExchange,
  ...ruSession,
  ...ruOnboarding,
};

export default ru;
