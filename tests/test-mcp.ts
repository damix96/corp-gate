import fs from 'node:fs';
import path from 'node:path';
import { CorpGateMcpServer } from '../internal/legacy-src/mcp/hooks-server.js';

export class McpTestRunner {
  private testHooksDir = path.resolve(process.cwd(), 'temp-mcp-hooks');
  private mcpServer: CorpGateMcpServer;

  constructor() {
    this.mcpServer = new CorpGateMcpServer({ hooksDir: this.testHooksDir });
  }

  public run = async (): Promise<void> => {
    fs.mkdirSync(this.testHooksDir, { recursive: true });
    const serverInstance = this.mcpServer.getMcpServer();
    const tools: Record<string, any> = {};
    const serverInternal = serverInstance as any;
    if (serverInternal._registeredTools) {
      for (const [name, toolDef] of Object.entries(serverInternal._registeredTools)) tools[name] = (toolDef as any).handler;
    }
    if (!tools['corpgate_get_last_context'] || !tools['corpgate_list_hooks']) throw new Error('Missing read-only MCP tools: ' + Object.keys(tools).join(', '));
    for (const removed of ['corpgate_save_hook', 'corpgate_test_hook', 'corpgate_toggle_hook', 'corpgate_delete_hook']) {
      if (tools[removed]) throw new Error('Unsafe hook tool still registered: ' + removed);
    }
    const lastCtxRes = await tools['corpgate_get_last_context']({});
    const lastCtxJson = JSON.parse(lastCtxRes.content[0].text);
    if (!lastCtxJson) throw new Error('corpgate_get_last_context failed');
    const listRes = await tools['corpgate_list_hooks']({});
    const listJson = JSON.parse(listRes.content[0].text);
    if (!Array.isArray(listJson)) throw new Error('corpgate_list_hooks failed: ' + listRes.content[0].text);
    fs.rmSync(this.testHooksDir, { recursive: true, force: true });
    console.log('MCP hook tools tests passed: read-only tools work and unsafe RCE/write tools are removed!');
  };
}

new McpTestRunner().run();
