import { RuntimeArguments } from '../../src/runtime/arguments.js';
import { CorpGateRuntime } from '../../src/runtime/service.js';

const args = new RuntimeArguments();
const runtime = new CorpGateRuntime(args.settings, app => ({
  register: () => { app.register(async () => { await new Promise<void>(() => {}); }); },
  close: async () => {},
}));

await runtime.start().catch(() => { process.exitCode = 1; });
