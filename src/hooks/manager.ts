import {
  CorpGateHook,
  RequestContext,
  ResponseContext,
  StreamChunkContext,
  StreamEndContext,
} from './types.js';

export class HookManager {
  private hooks: CorpGateHook[] = [];

  constructor(hooks: CorpGateHook[] = []) {
    this.hooks = [...hooks];
  }

  public registerHook = (hook: CorpGateHook): void => { this.hooks.push(hook); };

  public getHooks = (): CorpGateHook[] => this.hooks;

  public exportConfiguration = () => this.hooks.map((hook, index) => ({
    name: (hook as CorpGateHook & { name?: string }).name || 'hook-' + index,
    source: null,
    note: 'Registered programmatically; source module not provided',
  }));

  public runBeforeOutboundRequest = async (ctx: RequestContext): Promise<RequestContext> => {
    let current = { ...ctx };
    for (const hook of this.hooks) {
      if (hook.beforeOutboundRequest) {
        const res = await hook.beforeOutboundRequest(current);
        if (res) current = { ...res };
      }
    }
    return current;
  };

  public runAfterOutboundMask = async (body: string, ctx: RequestContext): Promise<string> => {
    let current = body;
    for (const hook of this.hooks) {
      if (hook.afterOutboundMask) {
        const res = await hook.afterOutboundMask(current, ctx);
        if (typeof res === 'string') current = res;
      }
    }
    return current;
  };

  public runBeforeInboundResponse = async (rawText: string, ctx: ResponseContext): Promise<string> => {
    let current = rawText;
    for (const hook of this.hooks) {
      if (hook.beforeInboundResponse) {
        const res = await hook.beforeInboundResponse(current, ctx);
        if (typeof res === 'string') current = res;
      }
    }
    return current;
  };

  public runAfterInboundUnmask = async (unmaskedText: string, ctx: ResponseContext): Promise<string> => {
    let current = unmaskedText;
    for (const hook of this.hooks) {
      if (hook.afterInboundUnmask) {
        const res = await hook.afterInboundUnmask(current, ctx);
        if (typeof res === 'string') current = res;
      }
    }
    return current;
  };

  public runBeforeStream = async (ctx: ResponseContext): Promise<void> => {
    for (const hook of this.hooks) if (hook.beforeStream) await hook.beforeStream(ctx);
  };

  public runStreamChunk = async (chunk: string, ctx: StreamChunkContext): Promise<string> => {
    let current = chunk;
    for (const hook of this.hooks) {
      if (hook.onStreamChunk) {
        const res = await hook.onStreamChunk(current, ctx);
        if (typeof res === 'string') current = res;
      }
    }
    return current;
  };

  public runAfterStream = async (ctx: StreamEndContext): Promise<void> => {
    for (const hook of this.hooks) if (hook.afterStream) await hook.afterStream(ctx);
  };
}
