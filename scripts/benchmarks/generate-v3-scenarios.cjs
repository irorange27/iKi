#!/usr/bin/env node

const fsp = require('node:fs/promises');
const path = require('node:path');
const { generateText } = require('ai');

const DEFAULT_PARALLEL = 5;
const DEFAULT_MODEL = 'deepseek-chat';

const normalizeText = value => {
  if (typeof value !== 'string') return '';
  return value.trim();
};

const ensureDir = async dirPath => {
  await fsp.mkdir(dirPath, { recursive: true });
};

const parseArgs = argv => {
  const parsed = {
    parallel: DEFAULT_PARALLEL,
    model: DEFAULT_MODEL,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected positional argument: ${arg}`);
    }

    const key = arg.slice(2);
    const next = argv[index + 1];
    const consumeValue = () => {
      if (!next || next.startsWith('--')) {
        throw new Error(`Missing value for --${key}`);
      }
      index += 1;
      return next;
    };

    switch (key) {
      case 'provider':
        parsed.providerType = normalizeText(consumeValue()).toLowerCase();
        break;
      case 'api-key':
        parsed.apiKey = consumeValue();
        break;
      case 'base-url':
        parsed.baseURL = consumeValue();
        break;
      case 'model':
        parsed.model = consumeValue();
        break;
      case 'output-dir':
        parsed.outputDir = consumeValue();
        break;
      case 'prompts':
        parsed.promptsPath = consumeValue();
        break;
      case 'parallel':
        parsed.parallel = Number.parseInt(consumeValue(), 10);
        break;
      case 'scenarios-only':
        parsed.scenariosOnly = true;
        break;
      case 'conversations-only':
        parsed.conversationsOnly = true;
        break;
      case 'scenarios-path':
        parsed.scenariosPath = consumeValue();
        break;
      case 'scene-ids':
        parsed.sceneIds = normalizeText(consumeValue())
          .split(',')
          .map(s => s.trim())
          .filter(Boolean);
        break;
      default:
        throw new Error(`Unknown option: --${key}`);
    }
  }

  if (!parsed.providerType) throw new Error('Missing required --provider');
  if (!parsed.apiKey) {
    parsed.apiKey = process.env.DEEPSEEK_API_KEY ||
      process.env.ANTHROPIC_AUTH_TOKEN ||
      process.env.OPENAI_API_KEY ||
      '';
  }
  if (!parsed.baseURL) {
    if (parsed.providerType === 'deepseek') {
      parsed.baseURL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
    }
  }
  if (!parsed.apiKey) throw new Error('Missing required --api-key (set via arg or env)');
  if (!parsed.outputDir) throw new Error('Missing required --output-dir');
  if (!parsed.promptsPath) throw new Error('Missing required --prompts');

  if (!Number.isFinite(parsed.parallel) || parsed.parallel <= 0) {
    parsed.parallel = DEFAULT_PARALLEL;
  }

  return parsed;
};

const createModel = options => {
  const providerType = options.providerType;

  if (providerType === 'deepseek') {
    const { createDeepSeek } = require('@ai-sdk/deepseek');
    const ds = createDeepSeek({
      apiKey: options.apiKey,
      ...(options.baseURL ? { baseURL: options.baseURL } : {}),
    });
    return ds(options.model);
  }

  if (providerType === 'openai') {
    const { createOpenAI } = require('@ai-sdk/openai');
    const oai = createOpenAI({
      apiKey: options.apiKey,
      ...(options.baseURL ? { baseURL: options.baseURL } : {}),
    });
    return oai(options.model);
  }

  if (providerType === 'minimax') {
    const { createMinimax } = require('vercel-minimax-ai-provider');
    const mm = createMinimax({
      apiKey: options.apiKey,
      ...(options.baseURL ? { baseURL: options.baseURL } : {}),
    });
    return mm(options.model);
  }

  const { createOpenAICompatible } = require('@ai-sdk/openai-compatible');
  const compat = createOpenAICompatible({
    name: providerType,
    apiKey: options.apiKey,
    baseURL: options.baseURL,
  });
  return compat(options.model);
};

const readJsonFile = async filePath =>
  JSON.parse(await fsp.readFile(path.resolve(filePath), 'utf8'));

const extractFirstJsonArray = text => {
  const source = normalizeText(text);
  if (!source) return null;

  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (start === -1) {
      if (char === '[') {
        start = index;
        depth = 1;
      }
      continue;
    }

    if (inString) {
      if (escaped) { escaped = false; continue; }
      if (char === '\\') { escaped = true; continue; }
      if (char === '"') { inString = false; }
      continue;
    }

    if (char === '"') { inString = true; continue; }
    if (char === '[') { depth += 1; continue; }
    if (char === ']') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }

  return null;
};

const parseJsonFromResponse = text => {
  const direct = normalizeText(text);
  if (!direct) return null;

  try { return JSON.parse(direct); } catch {}

  const fenceMatch = direct.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch?.[1]) {
    try { return JSON.parse(fenceMatch[1].trim()); } catch {}
  }

  const arrayText = extractFirstJsonArray(direct);
  if (arrayText) {
    try { return JSON.parse(arrayText); } catch {}
  }

  const objectMatch = direct.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    try { return JSON.parse(objectMatch[0]); } catch {}
  }

  return null;
};

const generateScenarios = async (model, prompts) => {
  const { system_prompt, user_prompt_template } = prompts.scenario_generation;

  process.stderr.write(`[v3-gen] Generating 30 scenarios...\n`);

  const result = await generateText({
    model,
    system: system_prompt,
    prompt: user_prompt_template,
    temperature: 0.8,
    maxTokens: 16000,
  });

  const text = result.text || '';
  const parsed = parseJsonFromResponse(text);

  if (!parsed) {
    const preview = text.length > 2000 ? text.slice(0, 2000) + '...(truncated)' : text;
    throw new Error(`Failed to parse scenario generation response. Raw preview:\n${preview}`);
  }

  const scenarios = Array.isArray(parsed) ? parsed : (parsed.scenarios || parsed.data || [parsed]);

  if (!Array.isArray(scenarios) || scenarios.length === 0) {
    throw new Error(`Parsed response but found no scenario array. Keys: ${Object.keys(parsed).join(', ')}`);
  }

  return scenarios.map(s => ({
    scene_id: normalizeText(s.scene_id || s.sceneId || s.id || ''),
    narrative: normalizeText(s.narrative || s.description || s.text || ''),
  })).filter(s => s.scene_id && s.narrative);
};

const validateConversation = conversation => {
  const errors = [];

  if (!conversation) {
    return ['conversation is null or undefined'];
  }

  const history = Array.isArray(conversation.history) ? conversation.history : [];

  if (history.length < 6) {
    errors.push(`history too short: ${history.length} messages (min 6)`);
  }
  if (history.length > 10) {
    errors.push(`history too long: ${history.length} messages (max 10)`);
  }
  if (history.length % 2 !== 0) {
    errors.push(`history has odd length ${history.length}, must be even (complete user+assistant pairs)`);
  }

  for (let i = 0; i < history.length; i += 1) {
    const expectedRole = i % 2 === 0 ? 'user' : 'assistant';
    if (history[i]?.role !== expectedRole) {
      errors.push(`history[${i}]: expected role "${expectedRole}", got "${history[i]?.role}"`);
    }
    if (!normalizeText(history[i]?.text)) {
      errors.push(`history[${i}]: empty text`);
    }
  }

  if (history.length > 0 && history[0]?.role !== 'user') {
    errors.push('history must start with user');
  }
  if (history.length > 0 && history[history.length - 1]?.role !== 'assistant') {
    errors.push('history must end with assistant');
  }

  const tc = conversation.task_context;
  if (!tc || typeof tc !== 'object') {
    errors.push('task_context is missing or not an object');
  } else {
    if (!normalizeText(tc.goal)) errors.push('task_context.goal is empty');
    if (!normalizeText(tc.deliverable)) errors.push('task_context.deliverable is empty');
    if (!Array.isArray(tc.constraints) || tc.constraints.length === 0) {
      errors.push('task_context.constraints is empty or not an array');
    }
  }

  if (!normalizeText(conversation.current_user_message)) {
    errors.push('current_user_message is empty');
  }

  return errors;
};

const generateOneConversation = async (model, prompts, scenario) => {
  const { system_prompt, user_prompt_template } = prompts.conversation_generation;
  const prompt = user_prompt_template
    .replace('{{narrative}}', scenario.narrative)
    .replace('{{scene_id}}', scenario.scene_id);

  const result = await generateText({
    model,
    system: system_prompt,
    prompt,
    temperature: 0.8,
    maxTokens: 8000,
  });

  const text = result.text || '';
  let parsed = parseJsonFromResponse(text);

  if (!parsed) {
    process.stderr.write(`[v3-gen] WARN: Failed to parse conversation for ${scenario.scene_id}, retrying for parse...\n`);
    const retry = await generateText({
      model,
      system: system_prompt,
      prompt: `${prompt}\n\nIMPORTANT: Output ONLY valid JSON, no markdown fences, no extra text.`,
      temperature: 0.6,
      maxTokens: 8000,
    });
    parsed = parseJsonFromResponse(retry.text || '');
  }

  if (!parsed) {
    process.stderr.write(`[v3-gen] ERROR: Parse retry also failed for ${scenario.scene_id}\n`);
    return null;
  }

  const conversation = {
    scene_id: scenario.scene_id,
    narrative: scenario.narrative,
    history: Array.isArray(parsed.history) ? parsed.history : [],
    current_user_message: normalizeText(parsed.current_user_message || ''),
    task_context: parsed.task_context || {},
  };

  const validationErrors = validateConversation(conversation);
  if (validationErrors.length > 0) {
    process.stderr.write(
      `[v3-gen] WARN: Validation failed for ${scenario.scene_id}: ${validationErrors.join('; ')}. Retrying...\n`
    );
    const fixPrompt = `${prompt}\n\n你的上一次输出没有通过结构校验，错误如下：\n${validationErrors.map(e => `- ${e}`).join('\n')}\n\n请修正后重新输出完整的 JSON。只输出 JSON，不要任何额外文字。`;
    const retry = await generateText({
      model,
      system: system_prompt,
      prompt: fixPrompt,
      temperature: 0.6,
      maxTokens: 8000,
    });
    const retryParsed = parseJsonFromResponse(retry.text || '');
    if (!retryParsed) {
      process.stderr.write(`[v3-gen] ERROR: Validation retry parse failed for ${scenario.scene_id}\n`);
      return null;
    }
    const retryConversation = {
      scene_id: scenario.scene_id,
      narrative: scenario.narrative,
      history: Array.isArray(retryParsed.history) ? retryParsed.history : [],
      current_user_message: normalizeText(retryParsed.current_user_message || ''),
      task_context: retryParsed.task_context || {},
    };
    const retryErrors = validateConversation(retryConversation);
    if (retryErrors.length > 0) {
      process.stderr.write(
        `[v3-gen] ERROR: Validation retry still failed for ${scenario.scene_id}: ${retryErrors.join('; ')}\n`
      );
      return null;
    }
    return retryConversation;
  }

  return conversation;
};

const generateConversations = async (model, prompts, scenarios, parallel) => {
  process.stderr.write(`[v3-gen] Generating conversations for ${scenarios.length} scenarios (parallel=${parallel})...\n`);

  const results = [];
  const queue = [...scenarios];

  const worker = async () => {
    while (queue.length > 0) {
      const scenario = queue.shift();
      if (!scenario) break;

      process.stderr.write(`[v3-gen]   Processing ${scenario.scene_id}...\n`);
      const conversation = await generateOneConversation(model, prompts, scenario);
      if (conversation) {
        results.push(conversation);
        process.stderr.write(`[v3-gen]   ${scenario.scene_id} OK (${results.length}/${scenarios.length})\n`);
      }
    }
  };

  const workers = Array.from({ length: Math.min(parallel, scenarios.length) }, () => worker());
  await Promise.all(workers);

  results.sort((a, b) => a.scene_id.localeCompare(b.scene_id));
  return results;
};

const writeJsonLines = async (filePath, rows) => {
  const serialized = rows.map(row => JSON.stringify(row)).join('\n');
  await fsp.writeFile(filePath, serialized ? `${serialized}\n` : '', 'utf8');
};

const main = async argv => {
  const options = parseArgs(argv);
  const outputDir = path.resolve(options.outputDir);
  await ensureDir(outputDir);

  const prompts = await readJsonFile(options.promptsPath);
  const model = createModel(options);
  const promptVersion = prompts.version || 'unknown';

  const scenariosPath = options.scenariosPath
    ? path.resolve(options.scenariosPath)
    : path.join(outputDir, 'scenarios.v1.jsonl');

  let scenarios;

  if (options.conversationsOnly) {
    if (!options.scenariosPath) {
      throw new Error('--conversations-only requires --scenarios-path');
    }
    const raw = await fsp.readFile(scenariosPath, 'utf8');
    scenarios = raw
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => JSON.parse(line));
    process.stderr.write(`[v3-gen] Loaded ${scenarios.length} existing scenarios\n`);
  } else {
    scenarios = await generateScenarios(model, prompts);
    process.stderr.write(`[v3-gen] Generated ${scenarios.length} scenarios\n`);

    await writeJsonLines(scenariosPath, scenarios);
    process.stderr.write(`[v3-gen] Saved scenarios to ${scenariosPath}\n`);
  }

  if (options.scenariosOnly) {
    process.stderr.write(`[v3-gen] Done (scenarios only). Saved ${scenarios.length} scenarios.\n`);
    return;
  }

  const toProcess = options.sceneIds?.length
    ? scenarios.filter(s => options.sceneIds.includes(s.scene_id))
    : scenarios;

  if (options.sceneIds?.length && toProcess.length === 0) {
    throw new Error(`No scenarios matched ids: ${options.sceneIds.join(', ')}`);
  }

  const conversations = await generateConversations(model, prompts, toProcess, options.parallel);

  const conversationsPath = path.join(outputDir, 'conversations.v1.jsonl');
  await writeJsonLines(conversationsPath, conversations);

  const generationSummary = {
    generatedAt: new Date().toISOString(),
    promptVersion,
    providerType: options.providerType,
    model: options.model,
    scenarioCount: scenarios.length,
    conversationCount: conversations.length,
    outputDir,
    scenariosPath,
    conversationsPath,
  };

  await fsp.writeFile(
    path.join(outputDir, 'generation-summary.json'),
    `${JSON.stringify(generationSummary, null, 2)}\n`,
    'utf8'
  );

  process.stderr.write(
    `[v3-gen] Done. ${conversations.length} conversations saved to ${conversationsPath}\n`
  );
  process.stdout.write(`${JSON.stringify(generationSummary, null, 2)}\n`);
};

module.exports = {
  parseArgs,
  createModel,
  parseJsonFromResponse,
  generateScenarios,
  generateOneConversation,
  generateConversations,
};

if (require.main === module) {
  void main(process.argv.slice(2)).catch(error => {
    process.stderr.write(`${String(error && error.stack ? error.stack : error)}\n`);
    process.exit(1);
  });
}
