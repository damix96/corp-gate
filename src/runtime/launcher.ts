import { setTimeout as delay } from 'node:timers/promises';
import semver from 'semver';
import { RuntimeClient } from './client.js';
import { RuntimeIdentity } from './identity.js';
import { RuntimeSettings } from './settings.js';
import { HostLaunch } from './host-launch.js';

export class RuntimeLauncher {
  private client: RuntimeClient;
  constructor(private settings = new RuntimeSettings(), private startHost: (timeout: number) => Promise<void> = new HostLaunch(settings).start) {
    this.client = new RuntimeClient(settings);
  }

  public status = async (): Promise<RuntimeIdentity | undefined> => (await this.client.inspect())?.identity;

  public ensure = async (force = false, requestedAt = Date.now()): Promise<RuntimeIdentity> => {
    const deadline = Date.now() + this.settings.startupTimeoutMs;
    const stopping = new Set<string>();
    let verificationFailure: Error | undefined;
    let verificationFailedAt: number | undefined;
    let launched = false;
    while (Date.now() < deadline) {
      let current;
      try { current = await this.client.inspect(); verificationFailure = undefined; verificationFailedAt = undefined; }
      catch (error) {
        verificationFailure = error as Error;
        verificationFailedAt ??= Date.now();
        if (Date.now() - verificationFailedAt > 1200) throw verificationFailure;
        await delay(60);
        continue;
      }
      if (!current) {
        if (!launched) { await this.startHost(Math.max(100, deadline - Date.now())); launched = true; }
        await delay(60);
        continue;
      }
      const identity = current.identity;
      if (!semver.valid(identity.version) || !semver.valid(this.settings.version)) throw new Error('Unsupported CorpGate version');
      const replace = semver.lt(identity.version, this.settings.version) || (force && identity.startedAt < requestedAt);
      if (identity.state === 'ready' && !replace) return identity;
      if (identity.state === 'ready' && replace && !stopping.has(identity.instanceId)) {
        await this.client.shutdown(current);
        stopping.add(identity.instanceId);
        launched = false;
      }
      await delay(60);
    }
    throw verificationFailure ?? new Error('CorpGate did not become ready before the startup deadline. Check the user-session launcher, npx in its PATH and package availability, then run npx corp-gate status. The AI client endpoint must remain unchanged until the provider probe passes.');
  };

  public stop = async (): Promise<boolean> => {
    const current = await this.client.inspect();
    if (!current) return false;
    await this.client.shutdown(current);
    const deadline = Date.now() + this.settings.startupTimeoutMs;
    while (Date.now() < deadline) {
      const next = await this.client.inspect();
      if (!next || next.identity.instanceId !== current.identity.instanceId) return true;
      await delay(60);
    }
    throw new Error('CorpGate is still draining active requests');
  };

}
