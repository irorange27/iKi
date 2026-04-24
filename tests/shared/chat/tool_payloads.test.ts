import { describe, expect, it } from 'vitest';

import { parseToolInput, parseToolOutput } from '../../../src/shared/chat/tool_payloads';

describe('parseToolInput', () => {
  it('parses JSON input and handles aliases', () => {
    const parsed = parseToolInput('web_search', '{"query":"hello","limit":3}');

    expect(parsed.kind).toBe('web');
    if (parsed.kind !== 'web') throw new Error('Expected web tool payload');
    expect(parsed.input.query).toBe('hello');
    expect(parsed.input.limit).toBe(3);
  });

  it('returns unknown for non-object input', () => {
    const parsed = parseToolInput('fetch', 'not json');
    expect(parsed).toEqual({ kind: 'unknown', input: 'not json' });
  });

  it('parses todo tool payloads from JSON', () => {
    const parsed = parseToolInput(
      'write_todo_list',
      '{"title":"Today","items":[{"content":"Ship feature","completed":false}]}'
    );

    expect(parsed.kind).toBe('write_todo_list');
    if (parsed.kind !== 'write_todo_list') throw new Error('Expected todo tool payload');
    expect(parsed.input.title).toBe('Today');
    expect(parsed.input.items?.[0]?.content).toBe('Ship feature');
  });

  it('parses execution todo inputs from JSON', () => {
    const parsed = parseToolInput(
      'todo',
      '{"items":[{"id":"1","text":"Inspect current code","status":"in_progress"}]}'
    );

    expect(parsed.kind).toBe('todo');
    if (parsed.kind !== 'todo') throw new Error('Expected todo payload');
    expect(parsed.input.items?.[0]?.text).toBe('Inspect current code');
    expect(parsed.input.items?.[0]?.status).toBe('in_progress');
  });

  it('parses delegated agent inputs from JSON', () => {
    const parsed = parseToolInput(
      'agent',
      '{"task":"Inspect the codebase","tools":["list_dir"],"maxIterations":3}'
    );

    expect(parsed.kind).toBe('agent');
    if (parsed.kind !== 'agent') throw new Error('Expected agent payload');
    expect(parsed.input.task).toBe('Inspect the codebase');
    expect(parsed.input.tools).toEqual(['list_dir']);
    expect(parsed.input.maxIterations).toBe(3);
  });

  it('parses load_skill inputs from JSON', () => {
    const parsed = parseToolInput('load_skill', '{"id":"user:planner"}');

    expect(parsed.kind).toBe('load_skill');
    if (parsed.kind !== 'load_skill') throw new Error('Expected load_skill payload');
    expect(parsed.input.id).toBe('user:planner');
  });

  it('parses personal skill write inputs from JSON', () => {
    const parsed = parseToolInput(
      'write_personal_skill',
      '{"id":"user:planner","skillName":"Planner","instructions":"# Planner\\n\\nStep 1."}'
    );

    expect(parsed.kind).toBe('write_personal_skill');
    if (parsed.kind !== 'write_personal_skill') {
      throw new Error('Expected write_personal_skill payload');
    }
    expect(parsed.input.id).toBe('user:planner');
    expect(parsed.input.skillName).toBe('Planner');
  });

  it('parses edit tool inputs from JSON', () => {
    const parsed = parseToolInput(
      'edit',
      '{"path":"src/app.ts","edits":[{"oldText":"before","newText":"after","replaceAll":false}]}'
    );

    expect(parsed.kind).toBe('edit');
    if (parsed.kind !== 'edit') throw new Error('Expected edit payload');
    expect(parsed.input.path).toBe('src/app.ts');
    expect(parsed.input.edits?.[0]?.oldText).toBe('before');
    expect(parsed.input.edits?.[0]?.newText).toBe('after');
    expect(parsed.input.edits?.[0]?.replaceAll).toBe(false);
  });

  it('parses proactive task write inputs from JSON', () => {
    const parsed = parseToolInput(
      'write_proactive_task',
      '{"action":"create","name":"Daily Gold","prompt":"Summarize gold price","schedule":{"kind":"daily","time":"09:00","timezone":"Asia/Shanghai"},"tools":["web","fetch"]}'
    );

    expect(parsed.kind).toBe('write_proactive_task');
    if (parsed.kind !== 'write_proactive_task') {
      throw new Error('Expected write_proactive_task payload');
    }
    expect(parsed.input.name).toBe('Daily Gold');
    expect(parsed.input.schedule?.kind).toBe('daily');
    expect(parsed.input.tools).toEqual(['web', 'fetch']);
  });

  it('parses awaiter write inputs from JSON', () => {
    const parsed = parseToolInput(
      'write_awaiter',
      '{"action":"create","title":"Resume Draft","instruction":"Continue the draft tomorrow morning.","trigger":{"kind":"time_after","delayMinutes":45}}'
    );

    expect(parsed.kind).toBe('write_awaiter');
    if (parsed.kind !== 'write_awaiter') {
      throw new Error('Expected write_awaiter payload');
    }
    expect(parsed.input.title).toBe('Resume Draft');
    expect(parsed.input.trigger?.kind).toBe('time_after');
    if (parsed.input.trigger?.kind !== 'time_after') {
      throw new Error('Expected time_after awaiter trigger');
    }
    expect(parsed.input.trigger.delayMinutes).toBe(45);
  });
});

describe('parseToolOutput', () => {
  it('parses list_dir outputs from JSON', () => {
    const parsed = parseToolOutput('list_dir', '[{"name":"src","isDirectory":true}]');

    expect(parsed.kind).toBe('list_dir');
    if (parsed.kind !== 'list_dir') throw new Error('Expected list_dir tool payload');
    expect(parsed.output[0]?.name).toBe('src');
  });

  it('returns unknown for unsupported tools', () => {
    const parsed = parseToolOutput('nope', { ok: true });
    expect(parsed).toEqual({ kind: 'unknown', output: { ok: true } });
  });

  it('parses todo tool outputs from JSON', () => {
    const parsed = parseToolOutput(
      'read_todo_list',
      '{"list":{"id":"todo_1","title":"Today","items":[{"content":"Ship feature","status":"pending"}]}}'
    );

    expect(parsed.kind).toBe('read_todo_list');
    if (parsed.kind !== 'read_todo_list') throw new Error('Expected read_todo_list payload');
    expect(parsed.output.list?.title).toBe('Today');
    expect(parsed.output.list?.items?.[0]?.status).toBe('pending');
  });

  it('parses execution todo outputs from JSON', () => {
    const parsed = parseToolOutput(
      'todo',
      '{"items":[{"id":"1","text":"Inspect current code","status":"completed"}],"rendered":"[x] #1: Inspect current code\\n\\n(1/1 completed)","totalCount":1,"completedCount":1}'
    );

    expect(parsed.kind).toBe('todo');
    if (parsed.kind !== 'todo') throw new Error('Expected todo output payload');
    expect(parsed.output.items?.[0]?.status).toBe('completed');
    expect(parsed.output.completedCount).toBe(1);
  });

  it('parses delegated agent outputs from JSON', () => {
    const parsed = parseToolOutput(
      'agent',
      '{"response":"Finished analysis","iterations":2,"toolCallCount":1,"usedTools":[{"name":"list_dir","callCount":1}],"model":{"providerType":"openai","model":"gpt-4o-mini"}}'
    );

    expect(parsed.kind).toBe('agent');
    if (parsed.kind !== 'agent') throw new Error('Expected agent output payload');
    expect(parsed.output.response).toBe('Finished analysis');
    expect(parsed.output.usedTools?.[0]?.name).toBe('list_dir');
    expect(parsed.output.model?.model).toBe('gpt-4o-mini');
  });

  it('parses load_skill outputs from JSON', () => {
    const parsed = parseToolOutput(
      'load_skill',
      '{"id":"user:planner","name":"Planner","source":"user","content":"<skill>...</skill>","truncated":false}'
    );

    expect(parsed.kind).toBe('load_skill');
    if (parsed.kind !== 'load_skill') throw new Error('Expected load_skill payload');
    expect(parsed.output.id).toBe('user:planner');
    expect(parsed.output.name).toBe('Planner');
    expect(parsed.output.truncated).toBe(false);
  });

  it('parses personal skill outputs from JSON', () => {
    const parsed = parseToolOutput(
      'read_personal_skill',
      '{"id":"user:planner","name":"Planner","description":"Planning support","source":"user","content":"---\\nname: \\"Planner\\"\\n---","truncated":false}'
    );

    expect(parsed.kind).toBe('read_personal_skill');
    if (parsed.kind !== 'read_personal_skill') {
      throw new Error('Expected read_personal_skill payload');
    }
    expect(parsed.output.id).toBe('user:planner');
    expect(parsed.output.description).toBe('Planning support');
    expect(parsed.output.truncated).toBe(false);
  });

  it('parses edit tool outputs from JSON', () => {
    const parsed = parseToolOutput(
      'edit',
      '{"path":"src/app.ts","success":true,"changed":true,"appliedEditCount":1,"totalReplacements":1}'
    );

    expect(parsed.kind).toBe('edit');
    if (parsed.kind !== 'edit') throw new Error('Expected edit output payload');
    expect(parsed.output.path).toBe('src/app.ts');
    expect(parsed.output.changed).toBe(true);
    expect(parsed.output.totalReplacements).toBe(1);
  });

  it('parses proactive task outputs from JSON', () => {
    const parsed = parseToolOutput(
      'read_proactive_task',
      '{"task":{"id":"task_1","name":"Daily Gold","schedule_type":"cron","cron_expression":"0 9 * * *","schedule_timezone":"Asia/Shanghai","schedule_summary":"0 9 * * * (Asia/Shanghai)","tool_mode":"manual","tools":["web","fetch"],"tool_summary":"Manual safe tools: web, fetch"}}'
    );

    expect(parsed.kind).toBe('read_proactive_task');
    if (parsed.kind !== 'read_proactive_task') {
      throw new Error('Expected read_proactive_task payload');
    }
    expect(parsed.output.task?.name).toBe('Daily Gold');
    expect(parsed.output.task?.tools).toEqual(['web', 'fetch']);
  });

  it('parses awaiter outputs from JSON', () => {
    const parsed = parseToolOutput(
      'read_awaiter',
      '{"awaiter":{"id":"awaiter_1","title":"Resume Draft","status":"armed","trigger_kind":"time_at","trigger_spec":{"kind":"time_at","at":"2026-04-24T01:00:00.000Z"},"trigger_summary":"Wake at 2026-04-24T01:00:00.000Z","delivery_mode":"thread","notify":true,"provider_type":"openai","model":"gpt-5.4"}}'
    );

    expect(parsed.kind).toBe('read_awaiter');
    if (parsed.kind !== 'read_awaiter') {
      throw new Error('Expected read_awaiter payload');
    }
    expect(parsed.output.awaiter?.title).toBe('Resume Draft');
    expect(parsed.output.awaiter?.trigger_kind).toBe('time_at');
    expect(parsed.output.awaiter?.trigger_spec).toEqual({
      kind: 'time_at',
      at: '2026-04-24T01:00:00.000Z',
    });
  });
});
