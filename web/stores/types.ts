export interface SecretRepresentation {
  format: string;
  alias: string;
  value?: string;
}

export interface SecretRecord {
  key: string;
  realValue?: string;
  alias: string;
  description?: string;
  maskInAi?: boolean;
  hitCount?: number;
  representations?: SecretRepresentation[];
  isSecret?: boolean;
  storage?: 'memory' | 'legacy' | 'manual' | 'protected' | string;
  writeRevision?: string | number;
  valueHidden?: boolean;
}

export interface PatchSecretPayload {
  isSecret?: boolean;
  realValue?: string;
  description?: string;
  expectedRevision?: string | number;
  name?: string;
}

export interface RevealSecretResponse {
  key: string;
  realValue: string;
  isSecret?: boolean;
}

export interface PatternRecord {
  id: string;
  name: string;
  pattern: string;
  regex?: string;
  type: string;
  label_template?: string | null;
  token_template?: string;
  enabled: boolean | number;
}

export interface PreviewMatch {
  transaction?: string;
  session: string;
  client?: string;
  endpoint?: string;
  path: string;
  role?: string;
  value: string;
  alias: string;
  existing?: boolean;
  before?: string;
  after?: string;
  contextId?: string;
  labelNotice?: string;
}

export interface PreviewResponse {
  revision: number;
  results: PreviewMatch[];
  contexts: Record<string, string>;
  next: number;
  matchOffset: number;
  total: number;
  scanned: number;
}

export type ProxyMode = 'direct' | 'system' | 'custom';

export interface SystemProxyConfig {
  httpProxy: string;
  httpsProxy: string;
  noProxy: string;
}

export interface RouteProxyConfig {
  proxyMode?: ProxyMode;
  httpProxy?: string;
  httpsProxy?: string;
  noProxy?: string;
}

export interface RouteRecord {
  id: string;
  name: string;
  prefix: string;
  upstreamUrl: string;
  targetUrl?: string;
  incomingUrl?: string;
  cliUrl?: string;
  suffix?: string;
  isCustom?: boolean;
  instructionKind?: string;
  proxyMode?: ProxyMode;
  httpProxy?: string;
  httpsProxy?: string;
  noProxy?: string;
}

export interface WorkspaceState {
  visible: string[];
  selected: string;
}

export interface SessionSummary {
  id: string;
  name?: string;
  client?: string;
  endpoint?: string;
  endpoints?: string[];
  firstSeen?: string;
  lastSeen?: string;
  timestamp?: string;
  activeCalls?: number;
  state?: 'active' | 'complete';
  latestTransactionId?: string;
}

export interface ResponseChangeFragment {
  text: string;
  start: number;
  end: number;
  contextStart?: number;
  totalLength?: number;
}

export interface ResponseRestoration {
  id?: string;
  fieldId?: string;
  source?: string;
  alias: string;
  value: string;
  key?: string;
  path?: string;
  before?: ResponseChangeFragment | string;
  after?: ResponseChangeFragment | string;
  protocol?: boolean;
  valueHidden?: boolean;
}

export interface ResponseChangesState {
  version?: number;
  status?: 'pending' | 'complete' | 'interrupted' | 'not-processed' | string;
  stage?: string;
  postHookModified?: boolean;
  interrupted?: boolean;
  items?: ResponseRestoration[];
}

export interface RequestContextRecord {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  client?: string;
  targetUrl?: string;
  provider?: string;
}

export interface ResponseContextRecord {
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
  isStream?: boolean;
  client?: string;
}

export interface SessionStep {
  id?: string;
  sessionId?: string;
  timestamp: string;
  status?: number;
  latencyMs?: number;
  provider?: string;
  targetProvider?: string;
  targetUrl?: string;
  client?: string;
  state?: 'active' | 'complete';
  request?: RequestContextRecord;
  maskedPrompt?: unknown;
  response?: ResponseContextRecord | unknown;
  responseChanges?: ResponseChangesState;
  interceptedSecrets?: Array<{ key: string; alias: string; realValue?: string; count?: number; valueHidden?: boolean; representations?: SecretRepresentation[] }>;
}
