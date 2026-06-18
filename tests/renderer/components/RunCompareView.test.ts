// @vitest-environment happy-dom

import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import RunCompareView from '../../../packages/desktop/src/renderer/components/RunCompareView.vue';
import type { AgentEvalComparison } from '@iki/core/types/agent_run';

const t = (key: string) => key;

const baseRun = {
  id: 'run_1',
  kind: 'chat-turn' as const,
  status: 'completed' as const,
  threadId: 'thread_1',
  parentRunId: null,
  rootRunId: 'run_1',
  providerType: 'openai',
  providerId: null,
  model: 'gpt-4',
  systemPrompt: '',
  enabledTools: [],
  availableSkillIds: [],
  input: {},
  working: { modelMessages: [], accumulatedText: '', pendingApprovalIds: [], lastStepIndex: 0 },
  output: null,
  error: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const baseTrace = {
  run: baseRun,
  steps: [],
  latestCheckpoint: null,
  children: [],
};

function makeComparison(overrides: Partial<AgentEvalComparison> = {}): AgentEvalComparison {
  return {
    runA: baseTrace,
    runB: { ...baseTrace, run: { ...baseRun, id: 'run_2', model: 'gpt-4.1' } },
    stepComparison: [],
    totalStepsA: 0,
    totalStepsB: 0,
    sharedToolCalls: 0,
    ...overrides,
  };
}

describe('RunCompareView', () => {
  it('renders the comparison title', () => {
    const wrapper = mount(RunCompareView, {
      props: { comparison: makeComparison(), t },
    });
    expect(wrapper.text()).toContain('Run Comparison');
  });

  it('shows baseline and test models', () => {
    const wrapper = mount(RunCompareView, {
      props: { comparison: makeComparison(), t },
    });
    expect(wrapper.text()).toContain('gpt-4');
    expect(wrapper.text()).toContain('gpt-4.1');
  });

  it('shows step counts', () => {
    const wrapper = mount(RunCompareView, {
      props: {
        comparison: makeComparison({ totalStepsA: 3, totalStepsB: 5 }),
        t,
      },
    });
    expect(wrapper.text()).toContain('3 steps');
    expect(wrapper.text()).toContain('5 steps');
  });

  it('renders matching steps', () => {
    const wrapper = mount(RunCompareView, {
      props: {
        comparison: makeComparison({
          totalStepsA: 1,
          totalStepsB: 1,
          stepComparison: [
            {
              stepIndex: 0,
              type: 'model',
              baselineStep: {
                id: 's1', runId: 'run_1', stepIndex: 0, type: 'model', status: 'completed',
                summary: 'Hello', input: null, output: null, startedAt: '', finishedAt: null,
              },
              comparisonStep: {
                id: 's2', runId: 'run_2', stepIndex: 0, type: 'model', status: 'completed',
                summary: 'Hello', input: null, output: null, startedAt: '', finishedAt: null,
              },
              match: true,
              labels: [],
            },
          ],
        }),
        t,
      },
    });
    // Both steps should render
    expect(wrapper.findAll('.compare-row').length).toBe(1);
    // No mismatch background
    expect(wrapper.find('.compare-row--mismatch').exists()).toBe(false);
    // Pass badge
    expect(wrapper.text()).toContain('chat.eval.regression.pass');
  });

  it('renders mismatched steps with fail badge', () => {
    const wrapper = mount(RunCompareView, {
      props: {
        comparison: makeComparison({
          totalStepsA: 1,
          totalStepsB: 1,
          stepComparison: [
            {
              stepIndex: 0,
              type: 'model',
              baselineStep: {
                id: 's1', runId: 'run_1', stepIndex: 0, type: 'model', status: 'completed',
                summary: 'A', input: null, output: null, startedAt: '', finishedAt: null,
              },
              comparisonStep: {
                id: 's2', runId: 'run_2', stepIndex: 0, type: 'tool-call', status: 'completed',
                summary: 'B', input: null, output: null, startedAt: '', finishedAt: null,
              },
              match: false,
              labels: [],
            },
          ],
        }),
        t,
      },
    });
    expect(wrapper.find('.compare-row--mismatch').exists()).toBe(true);
    expect(wrapper.text()).toContain('chat.eval.regression.fail');
  });

  it('renders missing step placeholder', () => {
    const wrapper = mount(RunCompareView, {
      props: {
        comparison: makeComparison({
          totalStepsA: 1,
          totalStepsB: 0,
          stepComparison: [
            {
              stepIndex: 0,
              type: 'model',
              baselineStep: {
                id: 's1', runId: 'run_1', stepIndex: 0, type: 'model', status: 'completed',
                summary: 'A', input: null, output: null, startedAt: '', finishedAt: null,
              },
              comparisonStep: null,
              match: false,
              labels: [],
            },
          ],
        }),
        t,
      },
    });
    expect(wrapper.text()).toContain('chat.eval.compare.missing');
  });

  it('renders labels on baseline steps', () => {
    const wrapper = mount(RunCompareView, {
      props: {
        comparison: makeComparison({
          totalStepsA: 1,
          totalStepsB: 1,
          stepComparison: [
            {
              stepIndex: 0,
              type: 'model',
              baselineStep: {
                id: 's1', runId: 'run_1', stepIndex: 0, type: 'model', status: 'completed',
                summary: 'A', input: null, output: null, startedAt: '', finishedAt: null,
              },
              comparisonStep: {
                id: 's2', runId: 'run_2', stepIndex: 0, type: 'model', status: 'completed',
                summary: 'A', input: null, output: null, startedAt: '', finishedAt: null,
              },
              match: true,
              labels: [
                { id: 'e1', runId: 'run_1', stepId: 's1', label: 'correct', note: null, createdAt: '', updatedAt: '' },
              ],
            },
          ],
        }),
        t,
      },
    });
    // Should show the label
    expect(wrapper.text()).toContain('chat.eval.label.correct');
  });
});
