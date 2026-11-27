import { RuntimeSettings } from './settings.js';
import { WindowsTask } from '../setup/windows-task.js';
import { UnixLaunch } from '../setup/unix-launch.js';

export class HostLaunch {
  constructor(private settings: RuntimeSettings) {}
  public start = async (_timeout: number): Promise<void> => {
    if (process.platform === 'win32') new WindowsTask(this.settings).start();
    else new UnixLaunch(this.settings).start(process.platform);
  };
}
