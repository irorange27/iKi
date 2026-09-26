// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import type { AgentRun, AgentRunTrace } from '@iki/backend/types/agent_run';
import type { ElectronApi } from '@iki/backend/types/electron_api';
import TrajectoryView from '../../../packages/desktop/src/renderer/views/TrajectoryView.vue';
import { setLocale } from '../../../packages/desktop/src/renderer/i18n';

const run = (id: string, second: string): AgentRun => ({
  id,
  rootRunId: id,
  threadId: 'thread',
  kind: 'chat-turn',
  status: 'completed',
  providerType: 'test',
  model: 'scripted-model',
  systemPrompt: 'System instructions',
  enabledTools: ['read_file'],
  availableSkillIds: [],
  input: { messages: [{ role: 'user', content: `Inspect ${id}` }] },
  working: { modelMessages: [], accumulatedText: '', pendingApprovalIds: [], lastStepIndex: 1 },
  createdAt: `2026-09-26T00:00:${second}.000Z`,
  updatedAt: `2026-09-26T00:01:${second}.000Z`,
});
const runs = [run('older', '00'), run('newer', '10')];
const traces: AgentRunTrace[] = runs.map(run => ({
  run,
  children: [],
  steps: [
    {
      id: `${run.id}-tool`,
      runId: run.id,
      stepIndex: 1,
      type: 'tool-call',
      status: 'completed',
      summary: 'Tool call',
      input: {
        toolCallId: `${run.id}-call`,
        toolName: 'read_file',
        input: { path: `${run.id}/needle.ts` },
      },
      output: { output: 'payload result' },
      startedAt: run.createdAt,
      finishedAt: run.createdAt,
    },
  ],
}));
const wrappers: VueWrapper[] = [];
const createView = async (records: AgentRunTrace[] = traces) => {
  setLocale('en');
  const api = {
    chat: {
      onRunStatus: () => () => undefined,
      runs: {
        list: vi.fn().mockResolvedValue(records.map(trace => trace.run).reverse()),
        getTrace: vi.fn(async id => records.find(trace => trace.run.id === id)),
        cancel: vi.fn().mockResolvedValue({ success: true }),
        retryAndExecute: vi.fn().mockResolvedValue({ success: true }),
        eval: { listLabels: vi.fn().mockResolvedValue([]) },
      },
    },
  } as unknown as Pick<ElectronApi, 'chat'>;
  const view = mount(TrajectoryView, {
    props: { threadId: 'thread', electronAPI: api },
    attachTo: document.body,
  });
  wrappers.push(view);
  await flushPromises();
  return view;
};
afterEach(() => {
  wrappers.splice(0).forEach(view => view.unmount());
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('trajectory browser', () => {
  it('keeps a queued run inspectable and cancellable before any steps or input have been recorded', async () => {
    const pending = {
      ...run('pending', '20'),
      status: 'queued' as const,
      systemPrompt: '',
      input: {},
    };
    const view = await createView([{ run: pending, children: [], steps: [] }]);
    expect(view.findAll('.ledger-row')).toHaveLength(0);
    expect(view.get('.ledger-run').text()).toContain('Queued');
    await view.get('[aria-label="Inspect run"]').trigger('click');
    expect(view.get('aside').text()).toContain('Queued');
    const cancel = view.findAll('aside button').find(button => button.text() === 'Cancel');
    if (!cancel) throw new Error('Queued run must expose Cancel');
    await cancel.trigger('click');
    await flushPromises();
    expect(view.props('electronAPI').chat.runs.cancel).toHaveBeenCalledWith('pending');
    await view.get('#trajectory-tab-raw').trigger('click');
    expect(JSON.parse(view.get('[role="tabpanel"]').text())).toMatchObject({
      id: 'pending',
      status: 'queued',
    });
  });

  it('opens details from a ledger row, exposes the recorded payload, and closes without removing the ledger', async () => {
    const view = await createView();
    expect(view.find('aside').exists()).toBe(false);
    await view.get('.ledger-row[data-record-id="older-tool"]').trigger('click');
    expect(view.get('aside').text()).toContain('Run 1');
    await view.get('#trajectory-tab-input').trigger('click');
    expect(view.get('[role="tabpanel"]').text()).toContain('older/needle.ts');
    await view.get('#trajectory-tab-output').trigger('click');
    expect(view.get('[role="tabpanel"]').text()).toContain('payload result');
    await view.get('#trajectory-tab-raw').trigger('click');
    expect(view.get('[role="tabpanel"]').text()).toContain('older-tool');
    await view.get('[aria-label="Close details"]').trigger('click');
    expect(view.find('aside').exists()).toBe(false);
    expect(view.findAll('.ledger-row')).toHaveLength(6);
  });

  it('searches payload and output without destroying records and restores them after clearing', async () => {
    const view = await createView();
    await view.get('input[type="search"]').setValue('payload result');
    expect(view.findAll('.ledger-row')).toHaveLength(2);
    await view.get('input[type="search"]').setValue('older/needle');
    expect(view.findAll('.ledger-row')).toHaveLength(1);
    expect(view.get('.ledger-row').attributes('data-record-id')).toBe('older-tool');
    await view.get('input[type="search"]').setValue('no match');
    expect(view.text()).toContain('No matching records');
    await view.get('input[type="search"]').setValue('');
    expect(view.findAll('.ledger-row')).toHaveLength(6);
  });

  it('selects a timeline record from a folded run and expands that run; keyboard follows the ledger', async () => {
    const view = await createView();
    const fold = view.findAll('.traj-toolbar button').find(button => button.text() === 'Runs');
    if (!fold) throw new Error('missing run fold control');
    await fold.trigger('click');
    expect(view.findAll('.ledger-row')).toHaveLength(0);
    await view.get('.timing-bar[data-record-id="older-tool"]').trigger('click', { detail: 0 });
    expect(view.get('.ledger-row[data-record-id="older-tool"]').attributes('aria-pressed')).toBe(
      'true'
    );
    expect(view.findAll('.ledger-row')).toHaveLength(3);
    await view.get('.ledger-row[data-record-id="older-tool"]').trigger('keydown', { key: 'Home' });
    expect(view.get('.ledger-row[data-record-id="older:system"]').attributes('aria-pressed')).toBe(
      'true'
    );
  });

  it('keeps a dragged timeline range visible and clears it with Escape', async () => {
    const view = await createView();
    const track = view.get('.cursor-crosshair');
    vi.spyOn(track.element, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 600, 50));
    await track.trigger('pointerdown', { button: 0, pointerId: 1, clientX: 100 });
    await track.trigger('pointermove', { pointerId: 1, clientX: 250 });
    await track.trigger('pointerup', { pointerId: 1, clientX: 250 });
    expect(view.find('.timing-selection').exists()).toBe(true);
    expect(view.findAll('.ledger-row.is-dimmed').length).toBeGreaterThan(0);
    await view.trigger('keydown', { key: 'Escape' });
    expect(view.find('.timing-selection').exists()).toBe(false);
  });
});
