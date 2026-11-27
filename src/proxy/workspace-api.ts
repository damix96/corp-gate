import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { VaultStore } from '../vault/store.js';
import { VaultDatabase, SecretRow } from '../vault/sqlite-db.js';
import { HookManager } from '../hooks/manager.js';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DefaultRoutes } from '../vault/default-routes.js';
import { RuntimeSessions } from './runtime-sessions.js';
import { CorpGateConfig } from '../types/index.js';
import { SecretProjection } from '../vault/secret-projection.js';

export class WorkspaceApi {
  constructor(private app: FastifyInstance, private db: VaultDatabase, private hooks: HookManager, private proxyConfig: Partial<CorpGateConfig>, private vault?: VaultStore, private runtime = new RuntimeSessions()) {}

  private archivedVersion = (row: SecretRow) => ({ ...SecretProjection.row(row), representations: row.is_secret ? undefined : this.db.archivedRepresentations.get(row), representationMetadata: this.db.archivedRepresentations.metadata(row) });

  private state = () => {
    const routes = this.db.getAllRoutes();
    let saved: { visible?: string[]; selected?: string } = {};
    try { saved = JSON.parse(this.db.getSetting('dashboard_workspace', '{}')); } catch {}
    const known = new Set(routes.filter(route => {
      const original = DefaultRoutes.definitions.find(item => item[0] === route.id);
      return route.is_custom || !original || route.upstream_url !== original[3] || route.name !== original[1] || this.runtime.hasRoute(route.prefix);
    }).map(route => route.id));
    const visible = [...new Set(saved.visible || [...known])].filter(id => routes.some(route => route.id === id));
    return { visible, selected: visible.includes(saved.selected || '') ? saved.selected : visible[0] || '' };
  };

  public register = () => {
    this.app.get('/api/workspace', async () => this.state());
    this.app.get('/api/client-help', async () => ({ zenPlugin: pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../internal/opencode/zen-connection')).href }));
    this.app.post('/api/workspace', async (req, reply) => {
      const parsed = z.object({ visible: z.array(z.string()).max(1000), selected: z.string() }).safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Failed to save connection selection' });
      const ids = this.db.getAllRoutes().map(route => route.id);
      if (parsed.data.visible.some(id => !ids.includes(id)) || (parsed.data.selected && !parsed.data.visible.includes(parsed.data.selected))) return reply.code(400).send({ error: 'Connection not found' });
      this.db.setSetting('dashboard_workspace', JSON.stringify(parsed.data));
      return this.state();
    });
    this.app.get<{ Querystring: { group?: string; groups?: string; id?: string } }>('/api/export', async (req, reply) => {
      const { group = 'all', id } = req.query;
      const manual = this.db.getSecrets();
      const versions = this.db.getVersions();
      const manualKeys = new Set(manual.map(entry => entry.key));
      const orphans = () => versions.filter(version => !manualKeys.has(version.key)).map(this.archivedVersion);
      const { adminToken: _omit, ...publicProxyConfig } = this.proxyConfig;
      const groups: Record<string, unknown[]> = {
        connections: this.db.getAllRoutes().map(route => ({ ...route, suffix: this.db.getSetting('route_suffix_' + route.id, '') })),
        patterns: this.db.getPatterns(),
        secrets: [...manual.map(entry => ({ ...SecretProjection.row(entry), origin: 'manual', representations: entry.is_secret ? undefined : this.vault?.getSecretRepresentations(entry), versions: versions.filter(version => version.key === entry.key).map(this.archivedVersion) })), ...(this.vault ? this.vault.getAutoSecrets().map(SecretProjection.autoExport) : this.db.getAutoSecrets().map(SecretProjection.autoRow))],
        hooks: this.hooks.exportConfiguration(),
        proxy: [{ id: 'proxy', ...publicProxyConfig }],
        settings: Object.entries(this.db.getAllSettings()).map(([key, value]) => ({ key, value })),
      };
      if (req.query.groups !== undefined) {
        const selected = [...new Set(req.query.groups.split(','))];
        if (id || !selected.length || selected.some(key => !Object.hasOwn(groups, key))) return reply.code(400).send({ error: 'Select sections to export' });
        const data = Object.fromEntries(selected.map(key => [key, key === 'settings' ? this.db.getAllSettings() : groups[key]]));
        if (selected.includes('secrets')) data.orphanedSecretVersions = orphans();
        return { format: 'corpgate-settings', version: 1, exportedAt: new Date().toISOString(), scope: 'selected', included: selected, data };
      }
      if (group !== 'all' && !Object.hasOwn(groups, group)) return reply.code(400).send({ error: 'Unknown export group' });
      const data: Record<string, unknown> = group === 'all' ? { ...groups, settings: this.db.getAllSettings() } : {
        [group]: id ? groups[group].filter(entry => {
          const item = entry as { id?: string; key?: string; name?: string };
          return (item.id || item.key || item.name) === id;
        }) : groups[group],
      };
      if (id && !(data[group] as unknown[])?.length) return reply.code(404).send({ error: 'Export target no longer exists' });
      if (!id && (group === 'all' || group === 'secrets')) data.orphanedSecretVersions = orphans();
      return { format: 'corpgate-settings', version: 1, exportedAt: new Date().toISOString(), scope: group, data, note: 'CorpGate settings. Conversation history and external app settings are excluded. Programmatically registered hooks require application source code.' };
    });
  };
}
