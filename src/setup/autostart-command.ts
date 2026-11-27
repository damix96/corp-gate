import { createInterface } from 'node:readline/promises';
import { RuntimeSettings } from '../runtime/settings.js';
import { AutostartInstaller, AutostartMode } from './autostart.js';

export class AutostartCommand {
  constructor(private settings: RuntimeSettings) {}
  public run = async (selected?: string): Promise<void> => {
    const installer = new AutostartInstaller(this.settings);
    const modes = installer.modes();
    let mode = selected;
    if (!mode) {
      const labels: Record<AutostartMode, string> = { shortcut: 'Shortcut in the user Startup folder', scheduler: 'Task Scheduler', registry: 'Current-user Run registry', launchagent: 'User LaunchAgent', xdg: 'Desktop autostart shortcut (XDG)', systemd: 'User systemd service', off: 'No autostart' };
      console.log('Autostart starts CorpGate after reboot and login. Without it, run npx corp-gate start after each reboot.\n');
      modes.forEach((item, index) => console.log(String(index + 1) + '. ' + labels[item] + ' (' + item + ')'));
      if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Choose with the user first, then run npx corp-gate autostart <' + modes.join('|') + '>. No autostart settings were changed.');
      const input = createInterface({ input: process.stdin, output: process.stdout });
      try { mode = modes[Number((await input.question('Your choice: ')).trim()) - 1]; }
      finally { input.close(); }
    }
    if (!mode || !modes.includes(mode as AutostartMode)) throw new Error('Choose one of: ' + modes.join(', '));
    console.log(JSON.stringify(installer.install(mode as AutostartMode)));
  };
}
