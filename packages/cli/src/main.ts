import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setConsoleLoggingEnabled } from '@iki/core/logger';
import { setPlatformInfo } from '@iki/core/platform';
import { wirePlatformContext } from '@iki/core/platform_wiring';
import { initializeDatabase } from '@iki/store/database';
import { getProviders } from '@iki/store/providers';
import { getToolModel } from '@iki/llm-pi-ai/tool_model';
import { startPiTurnHarness } from '@iki/harness/agent/harness';
import { registerStandardTools } from '@iki/harness/tools';
import { createChatService, type ChatStreamTarget } from '@iki/harness/thread_session';
import { createAgentRunTracker } from '@iki/harness/thread_session/run_tracker';
import { finalizeHarnessTurn, finalizeTurnFailure } from '@iki/harness/thread_session/turn_finalize';

type CliArgs = {
  dataDir: string;
  threadId?: string;
  providerType?: string;
  providerId?: string;
  model?: string;
  workspace?: string;
  tools?: string[];
  skills?: string[];
  skillMode?: 'manual' | 'auto';
  json: boolean;
  prompt: string;
};

const parseArgs = (argv: string[]): CliArgs => {
  let dataDir = process.env.IKI_DATA_DIR || path.join(os.homedir(), '.iki');
  let threadId: string | undefined;
  let providerType: string | undefined;
  let providerId: string | undefined;
  let model: string | undefined;
  let workspace: string | undefined;
  let tools: string[] | undefined;
  let skills: string[] | undefined;
  let skillMode: 'manual' | 'auto' | undefined;
  let json = false;
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--data-dir' && argv[i + 1]) {
      dataDir = path.resolve(argv[++i]);
    } else if (arg === '--thread' && argv[i + 1]) {
      threadId = argv[++i];
    } else if (arg === '--provider' && argv[i + 1]) {
      providerType = argv[++i];
    } else if (arg === '--provider-id' && argv[i + 1]) {
      providerId = argv[++i];
    } else if (arg === '--model' && argv[i + 1]) {
      model = argv[++i];
    } else if (arg === '--workspace' && argv[i + 1]) {
      workspace = path.resolve(argv[++i]);
    } else if (arg === '--tools' && argv[i + 1]) {
      tools = argv[++i].split(',').map(s => s.trim()).filter(Boolean);
    } else if (arg === '--skills' && argv[i + 1]) {
      skills = argv[++i].split(',').map(s => s.trim()).filter(Boolean);
    } else if (arg === '--skill-mode' && argv[i + 1]) {
      const mode = argv[++i];
      if (mode === 'manual' || mode === 'auto') skillMode = mode;
    } else if (arg === '--json') {
      json = true;
    } else if (arg === '-h' || arg === '--help') {
      console.log(
        'Usage: iki [options] <prompt>\n' +
          '  --data-dir <dir>         User data directory (default ~/.iki)\n' +
          '  --thread <id>            Existing or new thread id\n' +
          '  --provider <type>        Provider type (e.g. openai, anthropic)\n' +
          '  --provider-id <id>       Provider id from models.toml\n' +
          '  --model <id>             Model id\n' +
          '  --workspace <path>       Workspace directory path\n' +
          '  --tools <a,b>            Comma-separated tool names\n' +
          '  --skills <a,b>           Comma-separated skill ids\n' +
          '  --skill-mode <mode>      Skill mode: manual | auto\n' +
          '  --json                   Output structured JSON summary'
      );
      process.exit(0);
    } else {
      positional.push(arg);
    }
  }

  return {
    dataDir,
    ...(threadId ? { threadId } : {}),
    ...(providerType ? { providerType } : {}),
    ...(providerId ? { providerId } : {}),
    ...(model ? { model } : {}),
    ...(workspace ? { workspace } : {}),
    ...(tools ? { tools } : {}),
    ...(skills ? { skills } : {}),
    ...(skillMode ? { skillMode } : {}),
    json,
    prompt: positional.join(' ').trim(),
  };
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (!args.prompt) {
    console.error('Error: prompt is required. Run with --help for usage.');
    process.exit(1);
  }

  setConsoleLoggingEnabled(false);
  wirePlatformContext();
  setPlatformInfo({ userDataPath: args.dataDir });
  initializeDatabase();

  registerStandardTools({
    delegatedAgentRuntime: {
      createRunTracker: createAgentRunTracker,
      getConversationToolModel: getToolModel,
      createHarness: startPiTurnHarness,
      finalize: {
        finalizeFailure: finalizeTurnFailure,
        finalizeSuccess: finalizeHarnessTurn,
      },
    },
  });

  const providers = getProviders().filter(p => p.enabled);
  const selectedProvider =
    (args.providerId ? providers.find(p => p.id === args.providerId) : undefined) ??
    (args.providerType ? providers.find(p => p.type === args.providerType) : undefined) ??
    providers[0];

  const providerType = args.providerType ?? selectedProvider?.type;
  const providerId = args.providerId ?? selectedProvider?.id;
  const model = args.model ?? selectedProvider?.models?.[0];
  if (!providerType || !model) {
    console.error('Error: no enabled provider/model found. Configure models.toml or pass --provider and --model.');
    process.exit(1);
  }

  const chatService = createChatService();
  const threadId = args.threadId ?? `cli_${randomUUID().slice(0, 8)}`;
  if (!chatService.getThread(threadId)) {
    chatService.createThread({
      id: threadId,
      title: args.prompt.slice(0, 48),
      provider_type: providerType,
      ...(providerId ? { provider_id: providerId } : {}),
      model,
    });
  }

  let capturedUsage: Record<string, unknown> | undefined;
  let streamedText = '';

  const target: ChatStreamTarget = {
    id: 1,
    send: (channel: string, payload: unknown) => {
      if (channel !== 'chat:ui-chunk' || !payload || typeof payload !== 'object') return;
      const chunk = payload as Record<string, unknown>;
      if (chunk.type === 'text-delta' && typeof chunk.delta === 'string') {
        streamedText += chunk.delta;
        if (!args.json) process.stdout.write(chunk.delta);
      } else if (chunk.type === 'data-token-usage' && chunk.data && typeof chunk.data === 'object') {
        capturedUsage = chunk.data as Record<string, unknown>;
      } else if (!args.json && chunk.type === 'tool-input-available' && typeof chunk.toolName === 'string') {
        process.stderr.write(`\n[tool] ${chunk.toolName}\n`);
      }
    },
  };

  const history = chatService.listMessages(threadId);
  const userMessage = {
    id: `msg_${randomUUID()}`,
    role: 'user' as const,
    parts: [{ type: 'text' as const, text: args.prompt }],
  };

  const result = await chatService.stream(target, {
    threadId,
    providerType,
    ...(providerId ? { providerId } : {}),
    model,
    ...(args.tools ? { tools: args.tools } : {}),
    ...(args.skills ? { skillIds: args.skills } : {}),
    ...(args.skillMode ? { skillMode: args.skillMode } : {}),
    ...(args.workspace
      ? {
          workspaceSelection: {
            threadId,
            workspaceId: 'cli-workspace',
            workspace: {
              id: 'cli-workspace',
              name: path.basename(args.workspace),
              path: args.workspace,
              is_temporary: false,
              show_in_list: false,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          },
        }
      : {}),
    messages: [...history, userMessage],
  });

  const runId = 'runId' in result ? result.runId : undefined;
  const finalText = ('text' in result && typeof result.text === 'string' ? result.text : undefined) ?? streamedText;
  const errorText = 'error' in result && typeof result.error === 'string' ? result.error : undefined;

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          success: result.success,
          threadId,
          ...(runId ? { runId } : {}),
          text: finalText,
          usage: capturedUsage ?? null,
          ...(errorText ? { error: errorText } : {}),
        },
        null,
        2
      )
    );
  } else {
    process.stdout.write('\n');
  }

  if (!result.success) {
    process.exit(1);
  }
};

void main().catch(err => {
  console.error(err);
  process.exit(1);
});
