import { VaultMcpEndpoint } from '../mcp/endpoint.js';
import { CorpGateRuntime } from './service.js';
import { RuntimeSettings } from './settings.js';

export class RuntimeApplication {
  public static create = (settings = new RuntimeSettings()): CorpGateRuntime => new CorpGateRuntime(settings, (app, vault, options) => new VaultMcpEndpoint(app, vault, {
    version: options.version,
    mcpToken: options.mcpToken,
  }));
}
