import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { RuntimeSettings } from '../runtime/settings.js';
import { HostCommand } from './host-command.js';
import { AutostartFiles } from './autostart-files.js';
import { CommandRunner, SystemCommands } from './commands.js';

export type UnixAutostartMode = 'launchagent' | 'xdg' | 'systemd';

export class UnixLaunch {
  public readonly id: string;
  constructor(private settings: RuntimeSettings, private run: CommandRunner = SystemCommands.run, private env: NodeJS.ProcessEnv = process.env, private home = os.homedir()) {
    this.id = 'com.corpgate.user.' + createHash('sha256').update(settings.dataDir + '|' + settings.port).digest('hex').slice(0, 16);
  }
  public target = (mode: UnixAutostartMode): string => mode === 'launchagent' ? path.join(this.home, 'Library/LaunchAgents', this.id + '.plist') : path.join(this.env.XDG_CONFIG_HOME || path.join(this.home, '.config'), mode === 'xdg' ? 'autostart' : 'systemd/user', this.id + (mode === 'xdg' ? '.desktop' : '.service'));
  public content = (mode: UnixAutostartMode): string => {
    const args = HostCommand.args(this.settings);
    if (mode === 'launchagent') return '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>' + this.id + '</string><key>ProgramArguments</key><array><string>/usr/bin/env</string><string>npx</string>' + args.map(arg => '<string>' + HostCommand.xml(arg) + '</string>').join('') + '</array><key>EnvironmentVariables</key><dict><key>PATH</key><string>' + HostCommand.xml(HostCommand.path(this.env)) + '</string></dict><key>RunAtLoad</key><true/><key>LimitLoadToSessionType</key><string>Aqua</string></dict></plist>\n';
    if (mode === 'xdg') {
      const loginPath = HostCommand.path(this.env);
      if (/[\r\n\0"\\$`]/.test(loginPath)) throw new Error('The login PATH contains characters that cannot be saved safely in the desktop entry.');
      return '[Desktop Entry]\nType=Application\nName=CorpGate\nComment=' + this.id + '\nExec=env "PATH=' + loginPath.replace(/%/g, '%%') + '" npx ' + args.join(' ') + '\nTerminal=false\n';
    }
    return '[Unit]\nDescription=CorpGate ' + this.id + '\nPartOf=graphical-session.target\nAfter=graphical-session.target\n\n[Service]\nType=exec\nExecStart=/usr/bin/env npx ' + args.join(' ') + '\nEnvironment="PATH=' + this.escape(HostCommand.path(this.env)) + '"\n\n[Install]\nWantedBy=graphical-session.target\n';
  };
  public install = (mode: UnixAutostartMode): boolean => {
    if (mode === 'systemd') SystemCommands.require(this.run, 'systemctl', ['--user', 'show-environment'], 'A user systemd session is required for this autostart method.');
    const changed = AutostartFiles.save(this.target(mode), this.content(mode), this.id);
    if (mode === 'systemd') { SystemCommands.require(this.run, 'systemctl', ['--user', 'daemon-reload'], 'Could not reload the user systemd configuration.'); SystemCommands.require(this.run, 'systemctl', ['--user', 'enable', this.id + '.service'], 'Could not enable the user systemd service.'); }
    return changed;
  };
  public remove = (mode: UnixAutostartMode): boolean => {
    if (mode === 'systemd') SystemCommands.require(this.run, 'systemctl', ['--user', 'disable', this.id + '.service'], 'Could not disable the user systemd service.');
    const removed = AutostartFiles.remove(this.target(mode), this.id);
    if (mode === 'systemd') SystemCommands.require(this.run, 'systemctl', ['--user', 'daemon-reload'], 'Could not reload the user systemd configuration.');
    return removed;
  };
  public start = (platform: NodeJS.Platform): void => {
    if (platform === 'darwin') {
      const domain = 'gui/' + process.getuid!();
      const present = this.run('/bin/launchctl', ['print', domain + '/' + this.id]);
      if (!present.ok) { const temporary = path.join(this.settings.dataDir, this.id + '.plist'); AutostartFiles.save(temporary, this.content('launchagent').replace('<key>RunAtLoad</key><true/>', '<key>RunAtLoad</key><false/>'), this.id); SystemCommands.require(this.run, '/bin/launchctl', ['bootstrap', domain, temporary], 'Cannot load CorpGate in the logged-in macOS desktop session.'); }
      SystemCommands.require(this.run, '/bin/launchctl', ['kickstart', domain + '/' + this.id], 'Cannot start CorpGate in the macOS desktop session.');
      return;
    }
    if (platform !== 'linux' || (!this.env.DISPLAY && !this.env.WAYLAND_DISPLAY)) throw new Error('A logged-in graphical user session is required. Start CorpGate from that user desktop.');
    const graphical = this.run('systemctl', ['--user', 'is-active', 'graphical-session.target']);
    if (!graphical.ok) throw new Error('Immediate Linux launch requires an active graphical user systemd session. On a desktop without it, choose npx corp-gate autostart xdg and sign out/in to start at desktop login. No alternative method was attempted.');
    const environment = ['DISPLAY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS', 'XAUTHORITY'].filter(key => this.env[key]).map(key => '--setenv=' + key + '=' + this.env[key]);
    environment.push('--setenv=PATH=' + HostCommand.path(this.env));
    SystemCommands.require(this.run, 'systemd-run', ['--user', '--collect', '--unit=' + this.id + '-start', '--property=Type=exec', '--property=PartOf=graphical-session.target', ...environment, '/usr/bin/env', 'npx', ...HostCommand.args(this.settings)], 'Cannot start CorpGate through the graphical user service manager. No alternative launch method was attempted.');
  };
  private escape = (value: string): string => { if (/[\r\n\0]/.test(value)) throw new Error('Invalid login PATH'); return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/%/g, '%%'); };
}
