import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Container, visibleWidth } from '@earendil-works/pi-tui';
import { setPlatformInfo } from '@iki/core/platform';
import { wirePlatformContext } from '@iki/core/platform_wiring';
import { initializeDatabase } from '@iki/store/database';
import { createChatService, createThreadMailbox } from '@iki/harness/thread_session';
import { createSwarmManager } from '@iki/harness/swarm';
import { startShellCommand } from '@iki/tools/shell';
import {
  JobLiveTracker,
  LiveActivityStrip,
  SwarmLiveTracker,
} from '../src/live_monitor';
import {
  buildJobWatchPickerItems,
  buildSwarmWatchPickerItems,
  LiveWatchController,
} from '../src/live_views';

const tempDirs: string[] = [];

const makeTempDir = (prefix: string): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('TUI live monitor strip and watch views (Swarm + Jobs)', () => {
  it('streams worker live tool/thinking activity into strip and watch view, and tails/kills background jobs', async () => {
    const dataDir = makeTempDir('iki-live-tui-data-');
    const workDir = makeTempDir('iki-live-tui-work-');
    wirePlatformContext();
    setPlatformInfo({ userDataPath: dataDir });
    initializeDatabase();

    const chatService = createChatService();
    chatService.createThread({
      id: 'coord_live',
      title: 'Live TUI Thread',
      provider_type: 'openai',
      model: 'gpt-test',
    });

    let releaseWorker: (() => void) | null = null;
    const workerStarted = new Promise<void>(resolve => {
      releaseWorker = resolve;
    });
    let allowFinish!: () => void;
    const finishGate = new Promise<void>(resolve => {
      allowFinish = resolve;
    });

    const mailbox = createThreadMailbox({
      chat: {
        stream: async target => {
          target.send('chat:ui-chunk', { type: 'reasoning-delta', delta: 'Inspecting stats.js...' });
          target.send('chat:ui-chunk', {
            type: 'tool-input-available',
            toolCallId: 'call_1',
            toolName: 'bash',
            input: { command: 'node --test stats.js' },
          });
          releaseWorker?.();
          await finishGate;
          target.send('chat:ui-chunk', {
            type: 'tool-output-available',
            toolCallId: 'call_1',
            toolName: 'bash',
            output: { type: 'json', value: { stdout: 'all tests ok', exitCode: 0 } },
          });
          target.send('chat:ui-chunk', { type: 'text-delta', delta: 'Audit passed cleanly.' });
          return { success: true, text: 'Audit passed cleanly.' };
        },
        pushSteerByThread: () => false,
        cancelThreadStreams: () => undefined,
        isThreadRunning: () => false,
      },
    });

    const swarmManager = createSwarmManager({
      chatService,
      mailbox,
      getBuiltinTools: () => ['bash', 'job'],
    });

    const swarmTracker = new SwarmLiveTracker(swarmManager, () => 'coord_live');
    const jobTracker = new JobLiveTracker(() => new Set(['coord_live']));
    const strip = new LiveActivityStrip(swarmTracker, jobTracker);

    // Idle state: strip renders 0 rows (completely hidden)
    expect(strip.render(100)).toEqual([]);

    const started = swarmManager.startSwarm({
      coordinatorThreadId: 'coord_live',
      title: 'Live TUI Swarm',
      providerType: 'openai',
      model: 'gpt-test',
      workspaceSelection: null,
    });

    await swarmManager.add({
      callerThreadId: 'coord_live',
      name: 'auditor',
      brief: 'Inspect stats.js',
      workspace: 'inherit',
    });
    await workerStarted;

    // While worker is mid-turn running a bash tool, strip shows live activity clamped to width
    const activeLines = strip.render(90);
    expect(activeLines.length).toBeGreaterThanOrEqual(2);
    expect(activeLines.join('\n')).toContain('Live TUI Swarm');
    expect(activeLines.join('\n')).toContain('@auditor');
    expect(activeLines.join('\n')).toContain('node --test stats.js');
    for (const line of activeLines) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(90);
    }

    // Watch controller can open live worker stream, shared board, and return cleanly
    const headerSlot = new Container();
    const mainTranscript = new Container();
    const watchTranscript = new Container();
    const viewportContent = new Container();
    viewportContent.addChild(mainTranscript);

    const watch = new LiveWatchController({
      swarmManager,
      swarmTracker,
      getThreadId: () => 'coord_live',
      headerSlot,
      viewportContent,
      mainTranscript,
      watchTranscript,
      scrollToEnd: () => undefined,
      requestRender: () => undefined,
      onModeChanged: mode => {
        strip.setWatchedTarget({
          memberName: mode.kind === 'swarm-member' ? mode.memberName : null,
          jobId: mode.kind === 'job-log' ? mode.jobId : null,
        });
      },
    });

    expect(watch.openSwarmMember(started.swarm.id, 'auditor')).toBe(true);
    expect(watch.getMode().kind).toBe('swarm-member');
    const memberRender = watchTranscript.render(90).join('\n');
    expect(memberRender).toContain('Live turn in progress');
    expect(memberRender).toContain('node --test stats.js');

    const picker = buildSwarmWatchPickerItems(swarmTracker, watch.getMode());
    expect(picker?.items.some(i => i.value === 'member:auditor' && i.label.includes('* '))).toBe(true);

    // Let worker finish and verify board live watch
    allowFinish();
    await swarmManager.waitForIdle(started.swarm.id);

    watch.openSwarmBoard(started.swarm.id);
    expect(watch.getMode().kind).toBe('swarm-board');
    expect(watchTranscript.render(90).join('\n')).toContain('Inspect stats.js');

    // Start a real durable background shell job, verify strip + live job log viewer + kill
    const bgJob = await startShellCommand({
      toolName: 'bash',
      command: 'echo "hello-from-bg-job"; sleep 15',
      cwd: workDir,
      background: true,
      threadId: 'coord_live',
    });

    await new Promise(resolve => setTimeout(resolve, 200));
    expect(jobTracker.getRunningCount()).toBeGreaterThanOrEqual(1);
    const jobStripLines = strip.render(100).join('\n');
    expect(jobStripLines).toContain(bgJob.jobId);
    expect(jobStripLines).toContain('hello-from-bg-job');

    const jobPicker = buildJobWatchPickerItems(jobTracker, watch.getMode());
    expect(jobPicker.items.some(i => i.value === bgJob.jobId)).toBe(true);

    expect(watch.openJobLog(bgJob.jobId)).toBe(true);
    expect(watchTranscript.render(100).join('\n')).toContain('hello-from-bg-job');

    const killMsg = await watch.killWatchedJob();
    expect(killMsg).toContain('Killed job');

    watch.returnToMain();
    expect(watch.getMode().kind).toBe('main');
    swarmTracker.dispose();
  });
});
