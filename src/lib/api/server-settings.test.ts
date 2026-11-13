import { beforeEach, expect, it, vi } from 'vitest';
import { listServerSettings, getServerSettings, updateServerSettings } from './server-settings';
import { setUserUsername, setUserNickname } from './admin';
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
beforeEach(() => invoke.mockReset());
it('maps discovery, exact-namespace reads and atomic revision writes to dedicated IPC', async () => {
  await listServerSettings();
  expect(invoke).toHaveBeenLastCalledWith('list_server_settings', { namespace: null });
  await listServerSettings('security.password');
  expect(invoke).toHaveBeenLastCalledWith('list_server_settings', { namespace: 'security.password' });
  await getServerSettings('security.password', ['limit']);
  expect(invoke).toHaveBeenLastCalledWith('get_server_settings', { namespace: 'security.password', keys: ['limit'] });
  const changes = { limit: { value: 5, expected_revision: 2 } };
  await updateServerSettings('security.password', changes);
  expect(invoke).toHaveBeenLastCalledWith('update_server_settings', { namespace: 'security.password', changes });
});
it('keeps username and nickname operations distinct and preserves username whitespace', async () => {
  await setUserUsername('uuid', ' Alice ');
  expect(invoke).toHaveBeenLastCalledWith('set_user_username', { userId: 'uuid', username: ' Alice ' });
  await setUserNickname('uuid', null);
  expect(invoke).toHaveBeenLastCalledWith('set_user_nickname', { userId: 'uuid', nickname: null });
});
