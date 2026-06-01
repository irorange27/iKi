#!/usr/bin/env node

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');
const { performance } = require('node:perf_hooks');

const WebSocket = require('ws');
const { writeTraceArtifacts } = require('./trace_flamegraph.cjs');

const DEFAULT_HEALTH_TIMEOUT_MS = 30_000;
const DEFAULT_STREAM_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_LIMIT = Number.POSITIVE_INFINITY;
const DEFAULT_PARALLEL = 1;
const DEFAULT_BENCHMARK = 'generic';
const DEFAULT_DAEMON_URL = 'http://127.0.0.1:6127';
const LATENCY_PROFILE_VERSION = 1;
const BROWSECOMP_OFFICIAL_DATASET_URL =
  'https://openaipublic.blob.core.windows.net/simple-evals/browse_comp_test_set.csv';
const BROWSECOMP_QUERY_TEMPLATE = `
{Question}

Your response should be in the following format:
Explanation: {your explanation for your final answer}
Exact Answer: {your succinct, final answer}
Confidence: {your confidence score between 0% and 100% for your answer}
`.trim();
const BROWSECOMP_GRADER_TEMPLATE = `
Judge whether the following [response] to [question] is correct or not based on the precise and unambiguous [correct_answer] below.

[question]: {question}
[response]: {response}

Your judgement must be in the format and criteria specified below:
extracted_final_answer: The final exact answer extracted from the [response]. Put the extracted answer as 'None' if there is no exact, final answer to extract from the response.
[correct_answer]: {correct_answer}
reasoning: Explain why the extracted_final_answer is correct or incorrect based on [correct_answer], focusing only on if there are meaningful differences between [correct_answer] and the extracted_final_answer. Do not comment on any background to the problem, do not attempt to solve the problem, do not argue for any answer different than [correct_answer], focus only on whether the answers match.
correct: Answer 'yes' if extracted_final_answer matches the [correct_answer] given above, or is within a small margin of error for numerical problems. Answer 'no' otherwise, i.e. if there if there is any inconsistency, ambiguity, non-equivalency, or if the extracted answer is incorrect.
confidence: The extracted confidence score between 0|%| and 100|%| from [response]. Put 100 if there is no confidence score available.
`.trim();

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const isObjectRecord = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const roundDurationMs = value =>
  Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null;

const durationBetween = (startMs, endMs) => {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
    return null;
  }
  return roundDurationMs(endMs - startMs);
};

const shiftAtMs = (value, offsetMs) => {
  if (!Number.isFinite(value) || !Number.isFinite(offsetMs)) return null;
  return roundDurationMs(offsetMs + value);
};

const summarizeToolInput = value => {
  if (!isObjectRecord(value)) return null;

  const summary = {};
  const copyIfPresent = key => {
    if (typeof value[key] === 'string' && value[key].trim()) {
      summary[key] = value[key].trim();
    }
  };

  copyIfPresent('query');
  copyIfPresent('q');
  copyIfPresent('url');
  copyIfPresent('path');
  copyIfPresent('command');
  copyIfPresent('cmd');
  copyIfPresent('ticker');
  copyIfPresent('location');
  copyIfPresent('description');

  return Object.keys(summary).length > 0 ? summary : null;
};

const mergeTimeWindows = windows => {
  const normalized = windows
    .filter(
      window =>
        window &&
        Number.isFinite(window.startAtMs) &&
        Number.isFinite(window.endAtMs) &&
        window.endAtMs >= window.startAtMs
    )
    .sort((left, right) => left.startAtMs - right.startAtMs);

  if (normalized.length === 0) return [];

  const merged = [normalized[0]];
  for (let index = 1; index < normalized.length; index += 1) {
    const current = normalized[index];
    const last = merged[merged.length - 1];
    if (current.startAtMs <= last.endAtMs) {
      last.endAtMs = Math.max(last.endAtMs, current.endAtMs);
      continue;
    }
    merged.push({ ...current });
  }

  return merged;
};

const sumDurations = durations =>
  roundDurationMs(
    durations.reduce(
      (total, value) => total + (Number.isFinite(value) ? value : 0),
      0
    )
  ) ?? 0;

const sortObjectEntriesDescending = input =>
  Object.fromEntries(
    Object.entries(input).sort((left, right) => {
      const leftValue = Number.isFinite(left[1]) ? left[1] : Number.NEGATIVE_INFINITY;
      const rightValue = Number.isFinite(right[1]) ? right[1] : Number.NEGATIVE_INFINITY;
      return rightValue - leftValue;
    })
  );

const createLatencyRecorder = () => {
  const baseMs = performance.now();
  const phases = {};
  const marks = [];

  const now = () => roundDurationMs(performance.now() - baseMs) ?? 0;

  return {
    now,
    mark: (name, detail = {}) => {
      marks.push({
        name,
        atMs: now(),
        ...detail,
      });
    },
    startPhase: (name, detail = {}) => {
      phases[name] = {
        startedAtMs: now(),
        ...detail,
      };
      return phases[name];
    },
    endPhase: (name, detail = {}) => {
      const existing = phases[name] || {};
      const endedAtMs = now();
      phases[name] = {
        ...existing,
        ...detail,
        endedAtMs,
        durationMs: durationBetween(existing.startedAtMs, endedAtMs),
      };
      return phases[name];
    },
    snapshot: () => ({
      phases: JSON.parse(JSON.stringify(phases)),
      marks: JSON.parse(JSON.stringify(marks)),
    }),
  };
};

const buildStreamLatencyProfile = ({
  chunks,
  daemonEvents,
  wsOpenedAtMs = null,
  readyAtMs = null,
  startSentAtMs = null,
  completedAtMs = null,
  outcome = 'completed',
  error = null,
}) => {
  const toolCalls = [];
  const openToolCalls = new Map();
  const chunkTypeCounts = {};
  let firstChunkAtMs = null;
  let firstMeaningfulChunkAtMs = null;
  let firstTextDeltaAtMs = null;
  let firstToolCallAtMs = null;
  let firstToolResultAtMs = null;
  let firstContextReportAtMs = null;
  let firstMemoryRetrievalAtMs = null;
  let firstAffectSignalAtMs = null;
  let firstSkillUsageAtMs = null;
  let lastChunkAtMs = null;

  const getChunkAtMs = chunk =>
    isObjectRecord(chunk) && Number.isFinite(chunk.receivedAtMs) ? chunk.receivedAtMs : null;

  const ensureOpenToolCall = (chunk, atMs) => {
    const toolCallId =
      typeof chunk.toolCallId === 'string' && chunk.toolCallId.length > 0
        ? chunk.toolCallId
        : `unknown_${toolCalls.length + openToolCalls.size + 1}`;
    const existing = openToolCalls.get(toolCallId);
    if (existing) return existing;

    const created = {
      toolCallId,
      toolName:
        typeof chunk.toolName === 'string' && chunk.toolName.trim() ? chunk.toolName.trim() : 'tool',
      ordinal: toolCalls.length + openToolCalls.size + 1,
      startAtMs: atMs,
      inputReadyAtMs: null,
      firstPreliminaryOutputAtMs: null,
      endAtMs: null,
      durationMs: null,
      outcome: 'running',
      inputSummary: null,
    };
    openToolCalls.set(toolCallId, created);
    return created;
  };

  const finalizeToolCall = (toolCall, atMs, outcomeLabel) => {
    const endAtMs = Number.isFinite(atMs)
      ? atMs
      : Number.isFinite(toolCall.inputReadyAtMs)
        ? toolCall.inputReadyAtMs
        : toolCall.startAtMs;
    const finalized = {
      ...toolCall,
      endAtMs,
      durationMs: durationBetween(toolCall.startAtMs, endAtMs),
      outcome: outcomeLabel,
    };
    toolCalls.push(finalized);
    openToolCalls.delete(toolCall.toolCallId);
  };

  for (const chunk of chunks) {
    if (!isObjectRecord(chunk)) continue;
    const atMs = getChunkAtMs(chunk);
    if (Number.isFinite(atMs)) {
      if (firstChunkAtMs === null) firstChunkAtMs = atMs;
      lastChunkAtMs = atMs;
    }

    const type = typeof chunk.type === 'string' ? chunk.type : 'unknown';
    chunkTypeCounts[type] = (chunkTypeCounts[type] || 0) + 1;

    if (
      firstMeaningfulChunkAtMs === null &&
      Number.isFinite(atMs) &&
      type !== 'start' &&
      type !== 'text-start'
    ) {
      firstMeaningfulChunkAtMs = atMs;
    }

    if (type === 'text-delta' && firstTextDeltaAtMs === null && Number.isFinite(atMs)) {
      firstTextDeltaAtMs = atMs;
    }
    if (type === 'data-context-report' && firstContextReportAtMs === null && Number.isFinite(atMs)) {
      firstContextReportAtMs = atMs;
    }
    if (
      type === 'data-memory-retrieval' &&
      firstMemoryRetrievalAtMs === null &&
      Number.isFinite(atMs)
    ) {
      firstMemoryRetrievalAtMs = atMs;
    }
    if (type === 'data-affect-signal' && firstAffectSignalAtMs === null && Number.isFinite(atMs)) {
      firstAffectSignalAtMs = atMs;
    }
    if (type === 'data-skill-usage' && firstSkillUsageAtMs === null && Number.isFinite(atMs)) {
      firstSkillUsageAtMs = atMs;
    }

    if (type === 'tool-input-start') {
      const toolCall = ensureOpenToolCall(chunk, atMs);
      if (firstToolCallAtMs === null && Number.isFinite(atMs)) {
        firstToolCallAtMs = atMs;
      }
      if (!Number.isFinite(toolCall.startAtMs)) {
        toolCall.startAtMs = atMs;
      }
      if (!toolCall.toolName && typeof chunk.toolName === 'string') {
        toolCall.toolName = chunk.toolName;
      }
      continue;
    }

    if (type === 'tool-input-available' || type === 'tool-input-error') {
      const toolCall = ensureOpenToolCall(chunk, atMs);
      if (!Number.isFinite(toolCall.startAtMs)) {
        toolCall.startAtMs = atMs;
      }
      toolCall.inputReadyAtMs = Number.isFinite(atMs) ? atMs : toolCall.inputReadyAtMs;
      toolCall.inputSummary = summarizeToolInput(chunk.input) || toolCall.inputSummary;
      if (type === 'tool-input-error') {
        finalizeToolCall(toolCall, atMs, 'input_error');
      }
      continue;
    }

    if (type === 'tool-output-available') {
      const toolCall = ensureOpenToolCall(chunk, atMs);
      if (firstToolResultAtMs === null && Number.isFinite(atMs)) {
        firstToolResultAtMs = atMs;
      }
      if (chunk.preliminary === true) {
        if (toolCall.firstPreliminaryOutputAtMs === null && Number.isFinite(atMs)) {
          toolCall.firstPreliminaryOutputAtMs = atMs;
        }
        continue;
      }
      finalizeToolCall(toolCall, atMs, 'output_available');
      continue;
    }

    if (type === 'tool-output-error' || type === 'tool-output-denied') {
      const toolCall = ensureOpenToolCall(chunk, atMs);
      const outcomeLabel = type === 'tool-output-error' ? 'output_error' : 'output_denied';
      finalizeToolCall(toolCall, atMs, outcomeLabel);
    }
  }

  for (const toolCall of openToolCalls.values()) {
    finalizeToolCall(toolCall, toolCall.inputReadyAtMs ?? toolCall.startAtMs, 'incomplete');
  }

  const normalizedCompletedAtMs =
    completedAtMs ??
    lastChunkAtMs ??
    firstChunkAtMs ??
    startSentAtMs ??
    readyAtMs ??
    wsOpenedAtMs ??
    0;

  const mergedToolWindows = mergeTimeWindows(
    toolCalls.map(toolCall => ({
      startAtMs:
        toolCall.startAtMs ??
        toolCall.inputReadyAtMs ??
        toolCall.firstPreliminaryOutputAtMs ??
        toolCall.endAtMs,
      endAtMs:
        toolCall.endAtMs ??
        toolCall.firstPreliminaryOutputAtMs ??
        toolCall.inputReadyAtMs ??
        toolCall.startAtMs,
    }))
  );
  const toolExecutionMs = sumDurations(
    mergedToolWindows.map(window => durationBetween(window.startAtMs, window.endAtMs))
  );

  const modelBeforeFirstToolMs =
    mergedToolWindows.length > 0 ? durationBetween(startSentAtMs, mergedToolWindows[0].startAtMs) : null;
  const betweenToolsModelMs =
    mergedToolWindows.length > 1
      ? sumDurations(
          mergedToolWindows
            .slice(1)
            .map((window, index) =>
              durationBetween(mergedToolWindows[index].endAtMs, window.startAtMs)
            )
        )
      : 0;
  const modelAfterLastToolMs =
    mergedToolWindows.length > 0
      ? durationBetween(mergedToolWindows[mergedToolWindows.length - 1].endAtMs, normalizedCompletedAtMs)
      : null;
  const modelResponseMs =
    mergedToolWindows.length === 0 ? durationBetween(startSentAtMs, normalizedCompletedAtMs) : null;
  const handshakeMs = durationBetween(0, startSentAtMs);

  const perTool = {};
  for (const toolCall of toolCalls) {
    const key = toolCall.toolName || 'tool';
    if (!perTool[key]) {
      perTool[key] = {
        toolName: key,
        count: 0,
        totalDurationMs: 0,
        maxDurationMs: 0,
      };
    }
    perTool[key].count += 1;
    perTool[key].totalDurationMs += Number.isFinite(toolCall.durationMs) ? toolCall.durationMs : 0;
    perTool[key].maxDurationMs = Math.max(
      perTool[key].maxDurationMs,
      Number.isFinite(toolCall.durationMs) ? toolCall.durationMs : 0
    );
  }

  const perToolSummary = Object.values(perTool)
    .map(entry => ({
      toolName: entry.toolName,
      count: entry.count,
      totalDurationMs: roundDurationMs(entry.totalDurationMs) ?? 0,
      avgDurationMs: roundDurationMs(entry.totalDurationMs / entry.count) ?? 0,
      maxDurationMs: roundDurationMs(entry.maxDurationMs) ?? 0,
    }))
    .sort((left, right) => right.totalDurationMs - left.totalDurationMs);

  return {
    version: LATENCY_PROFILE_VERSION,
    outcome,
    ...(error ? { error } : {}),
    durationMs: roundDurationMs(normalizedCompletedAtMs) ?? 0,
    milestones: {
      wsOpenedAtMs: roundDurationMs(wsOpenedAtMs),
      readyAtMs: roundDurationMs(readyAtMs),
      startSentAtMs: roundDurationMs(startSentAtMs),
      firstChunkAtMs: roundDurationMs(firstChunkAtMs),
      firstMeaningfulChunkAtMs: roundDurationMs(firstMeaningfulChunkAtMs),
      firstTextDeltaAtMs: roundDurationMs(firstTextDeltaAtMs),
      firstToolCallAtMs: roundDurationMs(firstToolCallAtMs),
      firstToolResultAtMs: roundDurationMs(firstToolResultAtMs),
      firstContextReportAtMs: roundDurationMs(firstContextReportAtMs),
      firstMemoryRetrievalAtMs: roundDurationMs(firstMemoryRetrievalAtMs),
      firstAffectSignalAtMs: roundDurationMs(firstAffectSignalAtMs),
      firstSkillUsageAtMs: roundDurationMs(firstSkillUsageAtMs),
      completedAtMs: roundDurationMs(normalizedCompletedAtMs),
    },
    buckets: sortObjectEntriesDescending({
      handshakeMs,
      preFirstMeaningfulChunkMs: durationBetween(startSentAtMs, firstMeaningfulChunkAtMs),
      modelBeforeFirstToolMs,
      toolExecutionMs,
      betweenToolsModelMs,
      modelAfterLastToolMs,
      modelResponseMs,
    }),
    chunkTypeCounts: sortObjectEntriesDescending(chunkTypeCounts),
    toolCalls: toolCalls.map(toolCall => ({
      ...toolCall,
      startAtMs: roundDurationMs(toolCall.startAtMs),
      inputReadyAtMs: roundDurationMs(toolCall.inputReadyAtMs),
      firstPreliminaryOutputAtMs: roundDurationMs(toolCall.firstPreliminaryOutputAtMs),
      endAtMs: roundDurationMs(toolCall.endAtMs),
      durationMs: roundDurationMs(toolCall.durationMs),
    })),
    toolSummary: {
      totalCalls: toolCalls.length,
      totalWallTimeMs: toolExecutionMs,
      byTool: perToolSummary,
    },
    daemonEventCount: Array.isArray(daemonEvents) ? daemonEvents.length : 0,
  };
};

const buildTaskLatencyProfile = ({
  taskId,
  recorder,
  streamLatencyProfile = null,
  error = null,
  taskStartedAtRunMs = null,
  taskCompletedAtRunMs = null,
}) => {
  const snapshot = recorder.snapshot();
  const phases = snapshot.phases;
  const taskDurationMs = roundDurationMs(recorder.now()) ?? 0;
  const streamPhase = phases.stream || null;
  const scorePhase = phases.score || null;
  const threadCreatePhase = phases.threadCreate || null;
  const streamOffsetMs =
    streamPhase && Number.isFinite(streamPhase.startedAtMs) ? streamPhase.startedAtMs : null;

  const shiftedToolCalls =
    streamLatencyProfile && Number.isFinite(streamOffsetMs)
      ? streamLatencyProfile.toolCalls.map(toolCall => ({
          ...toolCall,
          startAtTaskMs: shiftAtMs(toolCall.startAtMs, streamOffsetMs),
          inputReadyAtTaskMs: shiftAtMs(toolCall.inputReadyAtMs, streamOffsetMs),
          firstPreliminaryOutputAtTaskMs: shiftAtMs(
            toolCall.firstPreliminaryOutputAtMs,
            streamOffsetMs
          ),
          endAtTaskMs: shiftAtMs(toolCall.endAtMs, streamOffsetMs),
        }))
      : [];

  const attribution = {
    threadCreateMs: threadCreatePhase?.durationMs ?? null,
    streamHandshakeMs: streamLatencyProfile?.buckets?.handshakeMs ?? null,
    modelBeforeFirstToolMs:
      streamLatencyProfile?.buckets?.modelBeforeFirstToolMs ??
      streamLatencyProfile?.buckets?.modelResponseMs ??
      null,
    toolExecutionMs: streamLatencyProfile?.buckets?.toolExecutionMs ?? null,
    betweenToolsModelMs: streamLatencyProfile?.buckets?.betweenToolsModelMs ?? null,
    modelAfterLastToolMs: streamLatencyProfile?.buckets?.modelAfterLastToolMs ?? null,
    scoreMs: scorePhase?.durationMs ?? null,
  };

  const topSources = Object.entries(attribution)
    .filter(([, value]) => Number.isFinite(value) && value > 0)
    .sort((left, right) => right[1] - left[1])
    .map(([name, value]) => ({
      name,
      durationMs: roundDurationMs(value),
      shareOfTask: taskDurationMs > 0 ? roundDurationMs(value / taskDurationMs) : null,
    }));

  return {
    version: LATENCY_PROFILE_VERSION,
    taskId,
    taskDurationMs,
    ...(error ? { error } : {}),
    ...(Number.isFinite(taskStartedAtRunMs) || Number.isFinite(taskCompletedAtRunMs)
      ? {
          runOffsets: {
            taskStartedAtRunMs: roundDurationMs(taskStartedAtRunMs),
            taskCompletedAtRunMs: roundDurationMs(taskCompletedAtRunMs),
          },
        }
      : {}),
    phases,
    marks: snapshot.marks,
    attribution,
    topSources,
    stream:
      streamLatencyProfile && Number.isFinite(streamOffsetMs)
        ? {
            ...streamLatencyProfile,
            startedAtTaskMs: roundDurationMs(streamOffsetMs),
            completedAtTaskMs: shiftAtMs(streamLatencyProfile.milestones.completedAtMs, streamOffsetMs),
            milestonesTaskMs: Object.fromEntries(
              Object.entries(streamLatencyProfile.milestones).map(([name, value]) => [
                name,
                shiftAtMs(value, streamOffsetMs),
              ])
            ),
            toolCalls: shiftedToolCalls,
          }
        : streamLatencyProfile,
  };
};

const buildLatencyRunSummary = taskResults => {
  const profiles = taskResults
    .map(task => task?.latencyProfile)
    .filter(profile => isObjectRecord(profile));

  const totalTaskDurationMs = sumDurations(
    profiles.map(profile => (Number.isFinite(profile.taskDurationMs) ? profile.taskDurationMs : 0))
  );
  const aggregateAttribution = {};
  const aggregateToolSummary = {};
  const milestoneSeries = {
    firstTextDeltaAtMs: [],
    firstToolCallAtMs: [],
    toolExecutionMs: [],
    threadCreateMs: [],
    streamHandshakeMs: [],
  };

  for (const profile of profiles) {
    for (const [key, value] of Object.entries(profile.attribution || {})) {
      if (!Number.isFinite(value)) continue;
      aggregateAttribution[key] = (aggregateAttribution[key] || 0) + value;
    }

    const firstTextDeltaAtMs = profile.stream?.milestones?.firstTextDeltaAtMs;
    if (Number.isFinite(firstTextDeltaAtMs)) {
      milestoneSeries.firstTextDeltaAtMs.push(firstTextDeltaAtMs);
    }
    const firstToolCallAtMs = profile.stream?.milestones?.firstToolCallAtMs;
    if (Number.isFinite(firstToolCallAtMs)) {
      milestoneSeries.firstToolCallAtMs.push(firstToolCallAtMs);
    }
    if (Number.isFinite(profile.stream?.toolSummary?.totalWallTimeMs)) {
      milestoneSeries.toolExecutionMs.push(profile.stream.toolSummary.totalWallTimeMs);
    }
    if (Number.isFinite(profile.attribution?.threadCreateMs)) {
      milestoneSeries.threadCreateMs.push(profile.attribution.threadCreateMs);
    }
    if (Number.isFinite(profile.attribution?.streamHandshakeMs)) {
      milestoneSeries.streamHandshakeMs.push(profile.attribution.streamHandshakeMs);
    }

    for (const toolCall of profile.stream?.toolCalls || []) {
      const toolName = toolCall.toolName || 'tool';
      if (!aggregateToolSummary[toolName]) {
        aggregateToolSummary[toolName] = {
          toolName,
          count: 0,
          totalDurationMs: 0,
          maxDurationMs: 0,
        };
      }
      aggregateToolSummary[toolName].count += 1;
      aggregateToolSummary[toolName].totalDurationMs +=
        Number.isFinite(toolCall.durationMs) ? toolCall.durationMs : 0;
      aggregateToolSummary[toolName].maxDurationMs = Math.max(
        aggregateToolSummary[toolName].maxDurationMs,
        Number.isFinite(toolCall.durationMs) ? toolCall.durationMs : 0
      );
    }
  }

  const averageOf = values =>
    values.length > 0 ? roundDurationMs(values.reduce((sum, value) => sum + value, 0) / values.length) : null;

  return {
    version: LATENCY_PROFILE_VERSION,
    profiledTasks: profiles.length,
    totalTaskDurationMs,
    averageTaskDurationMs:
      profiles.length > 0 ? roundDurationMs(totalTaskDurationMs / profiles.length) : null,
    topSources: Object.entries(aggregateAttribution)
      .filter(([, value]) => Number.isFinite(value) && value > 0)
      .sort((left, right) => right[1] - left[1])
      .map(([name, value]) => ({
        name,
        totalDurationMs: roundDurationMs(value),
        avgDurationMs: profiles.length > 0 ? roundDurationMs(value / profiles.length) : null,
        shareOfProfiledTaskTime:
          totalTaskDurationMs > 0 ? roundDurationMs(value / totalTaskDurationMs) : null,
      })),
    perTool: Object.values(aggregateToolSummary)
      .map(entry => ({
        toolName: entry.toolName,
        count: entry.count,
        totalDurationMs: roundDurationMs(entry.totalDurationMs) ?? 0,
        avgDurationMs: roundDurationMs(entry.totalDurationMs / entry.count) ?? 0,
        maxDurationMs: roundDurationMs(entry.maxDurationMs) ?? 0,
      }))
      .sort((left, right) => right.totalDurationMs - left.totalDurationMs),
    averages: {
      firstTextDeltaAtMs: averageOf(milestoneSeries.firstTextDeltaAtMs),
      firstToolCallAtMs: averageOf(milestoneSeries.firstToolCallAtMs),
      toolExecutionMs: averageOf(milestoneSeries.toolExecutionMs),
      threadCreateMs: averageOf(milestoneSeries.threadCreateMs),
      streamHandshakeMs: averageOf(milestoneSeries.streamHandshakeMs),
    },
    slowestTasks: profiles
      .map(profile => ({
        taskId: profile.taskId,
        taskDurationMs: roundDurationMs(profile.taskDurationMs) ?? 0,
        topSource: profile.topSources?.[0] || null,
      }))
      .sort((left, right) => right.taskDurationMs - left.taskDurationMs)
      .slice(0, 10),
  };
};

const buildDaemonBenchmarkVisualization = ({
  benchmark,
  options,
  runProfile,
  taskResults,
}) => {
  const spans = [];
  const markers = [];
  const tracks = ['Benchmark Run', 'Run Phases'];
  const runTotalDurationMs =
    runProfile?.phases?.benchmark?.durationMs ??
    sumDurations(taskResults.map(task => task?.latencyProfile?.taskDurationMs || 0));

  spans.push({
    track: 'Benchmark Run',
    label: `${benchmark} benchmark`,
    startMs: 0,
    durationMs: runTotalDurationMs,
    category: 'run',
    detail: {
      benchmark,
      providerType: options.providerType,
      model: options.model,
      parallel: options.parallel,
    },
  });

  for (const [phaseName, phase] of Object.entries(runProfile?.phases || {})) {
    if (phaseName === 'benchmark') continue;
    if (!Number.isFinite(phase?.startedAtMs) || !Number.isFinite(phase?.durationMs)) continue;
    spans.push({
      track: 'Run Phases',
      label: phaseName,
      startMs: phase.startedAtMs,
      durationMs: phase.durationMs,
      category:
        phaseName === 'executeTasks'
          ? 'daemon'
          : phaseName === 'writeOutputs'
            ? 'io'
            : 'phase',
      detail: phase,
    });
  }

  for (const task of taskResults) {
    const profile = task?.latencyProfile;
    const taskStartedAtRunMs = profile?.runOffsets?.taskStartedAtRunMs;
    if (!profile || !Number.isFinite(taskStartedAtRunMs)) continue;

    const taskTrack = `Task ${task.id}`;
    const streamTrack = `Task ${task.id} / Stream`;
    const eventTrack = `Task ${task.id} / Events`;
    tracks.push(taskTrack, streamTrack, eventTrack);

    spans.push({
      track: taskTrack,
      label: task.id,
      startMs: taskStartedAtRunMs,
      durationMs: profile.taskDurationMs,
      category: 'task',
      detail: {
        success: task.success,
        chunkCount: task.chunkCount,
      },
    });

    for (const [phaseName, phase] of Object.entries(profile.phases || {})) {
      if (!Number.isFinite(phase?.startedAtMs) || !Number.isFinite(phase?.durationMs)) continue;
      spans.push({
        track: taskTrack,
        label: phaseName,
        startMs: taskStartedAtRunMs + phase.startedAtMs,
        durationMs: phase.durationMs,
        category:
          phaseName === 'threadCreate'
            ? 'phase'
            : phaseName === 'stream'
              ? 'stream'
              : phaseName === 'score'
                ? 'scoring'
                : 'phase',
        detail: phase,
      });
    }

    const stream = profile.stream;
    if (stream && Number.isFinite(stream.startedAtTaskMs)) {
      const streamBaseAtRunMs = taskStartedAtRunMs + stream.startedAtTaskMs;
      spans.push({
        track: streamTrack,
        label: 'stream',
        startMs: streamBaseAtRunMs,
        durationMs: stream.durationMs,
        category: 'stream',
        detail: {
          outcome: stream.outcome,
          daemonEventCount: stream.daemonEventCount,
        },
      });

      const bucketEntries = [];
      const milestone = stream.milestones || {};
      if (Number.isFinite(milestone.startSentAtMs) && Number.isFinite(milestone.firstMeaningfulChunkAtMs)) {
        bucketEntries.push({
          label: 'wait_first_meaningful_chunk',
          startMs: milestone.startSentAtMs,
          durationMs: milestone.firstMeaningfulChunkAtMs - milestone.startSentAtMs,
          category: 'model',
        });
      }
      if (stream.toolCalls?.length > 0) {
        const calls = stream.toolCalls.filter(toolCall => Number.isFinite(toolCall.startAtMs));
        if (calls.length > 0) {
          const firstTool = calls[0];
          if (Number.isFinite(milestone.startSentAtMs) && firstTool.startAtMs > milestone.startSentAtMs) {
            bucketEntries.push({
              label: 'model_before_first_tool',
              startMs: milestone.startSentAtMs,
              durationMs: firstTool.startAtMs - milestone.startSentAtMs,
              category: 'model',
            });
          }
          for (const toolCall of calls) {
            spans.push({
              track: streamTrack,
              label: `${toolCall.toolName}#${toolCall.ordinal}`,
              startMs: streamBaseAtRunMs + toolCall.startAtMs,
              durationMs: toolCall.durationMs,
              category: 'tool',
              detail: {
                outcome: toolCall.outcome,
                inputSummary: toolCall.inputSummary,
              },
            });
          }
        }
      } else if (Number.isFinite(stream.buckets?.modelResponseMs) && Number.isFinite(milestone.startSentAtMs)) {
        bucketEntries.push({
          label: 'model_response',
          startMs: milestone.startSentAtMs,
          durationMs: stream.buckets.modelResponseMs,
          category: 'model',
        });
      }

      for (const bucket of bucketEntries) {
        if (!Number.isFinite(bucket.durationMs) || bucket.durationMs <= 0) continue;
        spans.push({
          track: streamTrack,
          label: bucket.label,
          startMs: streamBaseAtRunMs + bucket.startMs,
          durationMs: bucket.durationMs,
          category: bucket.category,
        });
      }

      const markerEntries = [
        ['ready', milestone.readyAtMs],
        ['start_sent', milestone.startSentAtMs],
        ['first_context_report', milestone.firstContextReportAtMs],
        ['first_memory_retrieval', milestone.firstMemoryRetrievalAtMs],
        ['first_tool_call', milestone.firstToolCallAtMs],
        ['first_text_delta', milestone.firstTextDeltaAtMs],
        ['completed', milestone.completedAtMs],
      ];
      for (const [label, value] of markerEntries) {
        if (!Number.isFinite(value)) continue;
        markers.push({
          track: eventTrack,
          label,
          atMs: streamBaseAtRunMs + value,
          category: 'event',
        });
      }
    }
  }

  return {
    title: `Daemon benchmark flamegraph (${benchmark})`,
    totalDurationMs: runTotalDurationMs,
    spans,
    markers,
    tracks,
    metadata: {
      benchmark,
      providerType: options.providerType,
      model: options.model,
      parallel: options.parallel,
    },
  };
};

const normalizeProviderType = value => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim().toLowerCase();
  return trimmed;
};

const parseArgs = argv => {
  const parsed = {
    benchmark: DEFAULT_BENCHMARK,
    host: '127.0.0.1',
    healthTimeoutMs: DEFAULT_HEALTH_TIMEOUT_MS,
    streamTimeoutMs: DEFAULT_STREAM_TIMEOUT_MS,
    limit: DEFAULT_LIMIT,
    parallel: DEFAULT_PARALLEL,
    spawnDaemon: false,
    keepDaemon: false,
    keepProfile: false,
    browsecompOfficial: false,
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
      case 'tasks':
        parsed.tasksPath = consumeValue();
        break;
      case 'output-dir':
        parsed.outputDir = consumeValue();
        break;
      case 'provider':
        parsed.providerType = consumeValue();
        break;
      case 'model':
        parsed.model = consumeValue();
        break;
      case 'benchmark':
        parsed.benchmark = consumeValue().trim() || DEFAULT_BENCHMARK;
        break;
      case 'daemon-url':
        parsed.daemonUrl = consumeValue();
        break;
      case 'host':
        parsed.host = consumeValue();
        break;
      case 'port':
        parsed.port = Number.parseInt(consumeValue(), 10);
        break;
      case 'spawn-daemon':
        parsed.spawnDaemon = true;
        break;
      case 'keep-daemon':
        parsed.keepDaemon = true;
        break;
      case 'user-data-path':
        parsed.userDataPath = consumeValue();
        break;
      case 'keep-profile':
        parsed.keepProfile = true;
        break;
      case 'client-id':
        parsed.clientId = consumeValue();
        break;
      case 'client-token':
        parsed.clientToken = consumeValue();
        break;
      case 'bootstrap-token':
        parsed.bootstrapToken = consumeValue();
        break;
      case 'client-name':
        parsed.clientName = consumeValue();
        break;
      case 'tools':
        parsed.tools = consumeValue();
        break;
      case 'skill-mode':
        parsed.skillMode = consumeValue();
        break;
      case 'limit':
        parsed.limit = Number.parseInt(consumeValue(), 10);
        break;
      case 'parallel':
        parsed.parallel = Number.parseInt(consumeValue(), 10);
        break;
      case 'health-timeout-ms':
        parsed.healthTimeoutMs = Number.parseInt(consumeValue(), 10);
        break;
      case 'stream-timeout-ms':
        parsed.streamTimeoutMs = Number.parseInt(consumeValue(), 10);
        break;
      case 'max-iterations':
        parsed.maxIterations = Number.parseInt(consumeValue(), 10);
        break;
      case 'judge-provider':
        parsed.judgeProviderType = consumeValue();
        break;
      case 'judge-model':
        parsed.judgeModel = consumeValue();
        break;
      case 'browsecomp-official':
        parsed.browsecompOfficial = true;
        break;
      case 'browsecomp-url':
        parsed.browsecompUrl = consumeValue();
        break;
      case 'profile-latency':
        parsed.profileLatency = true;
        break;
      default:
        throw new Error(`Unknown option: --${key}`);
    }
  }

  parsed.providerType = normalizeProviderType(parsed.providerType);
  parsed.judgeProviderType = normalizeProviderType(parsed.judgeProviderType);

  if (!parsed.providerType) throw new Error('Missing required --provider');
  if (!parsed.model) throw new Error('Missing required --model');

  const benchmark = parsed.benchmark.trim().toLowerCase();
  if (!parsed.tasksPath && !(benchmark === 'browsecomp' || parsed.browsecompOfficial)) {
    throw new Error('Missing required --tasks');
  }

  if (!Number.isFinite(parsed.limit) || parsed.limit <= 0) {
    parsed.limit = DEFAULT_LIMIT;
  }
  if (!Number.isFinite(parsed.parallel) || parsed.parallel <= 0) {
    parsed.parallel = DEFAULT_PARALLEL;
  }
  if (!Number.isFinite(parsed.healthTimeoutMs) || parsed.healthTimeoutMs <= 0) {
    parsed.healthTimeoutMs = DEFAULT_HEALTH_TIMEOUT_MS;
  }
  if (!Number.isFinite(parsed.streamTimeoutMs) || parsed.streamTimeoutMs <= 0) {
    parsed.streamTimeoutMs = DEFAULT_STREAM_TIMEOUT_MS;
  }
  if (
    parsed.maxIterations !== undefined &&
    (!Number.isFinite(parsed.maxIterations) || parsed.maxIterations <= 0)
  ) {
    delete parsed.maxIterations;
  }

  return parsed;
};

const parseList = value =>
  typeof value === 'string'
    ? value
        .split(',')
        .map(entry => entry.trim())
        .filter(Boolean)
    : [];

const GENERIC_BENCHMARK_TOOLS = [
  'read_file',
  'write_file',
  'edit',
  'list_dir',
  'shell',
  'web',
  'fetch',
];

const getDefaultToolsForBenchmark = benchmark => {
  switch (benchmark.trim().toLowerCase()) {
    case 'browsecomp':
      return ['web', 'fetch'];
    case 'gaia':
      return ['web', 'fetch'];
    case 'generic':
      return GENERIC_BENCHMARK_TOOLS;
    default:
      return [];
  }
};

const ensureDir = async dirPath => {
  await fsp.mkdir(dirPath, { recursive: true });
};

const findOpenPort = async host =>
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, host, () => {
      const address = server.address();
      const port =
        typeof address === 'object' && address && Number.isInteger(address.port)
          ? address.port
          : null;
      server.close(error => {
        if (error) {
          reject(error);
          return;
        }
        if (!port) {
          reject(new Error('Failed to resolve an available port'));
          return;
        }
        resolve(port);
      });
    });
  });

const deriveDaemonUrl = ({ daemonUrl, host, port }) => {
  if (typeof daemonUrl === 'string' && daemonUrl.trim()) {
    return daemonUrl.trim().replace(/\/+$/g, '');
  }

  if (host && port) {
    return `http://${host}:${port}`;
  }

  return DEFAULT_DAEMON_URL;
};

const toWsUrl = baseUrl => {
  const parsed = new URL(baseUrl);
  parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
  parsed.pathname = '/v1/chat/stream';
  parsed.search = '';
  return parsed.toString();
};

const readBootstrapToken = async userDataPath => {
  const tokenPath = path.join(userDataPath, 'daemon.token');
  return (await fsp.readFile(tokenPath, 'utf8')).trim();
};

const parseCsvRecords = text => {
  const rows = [];
  let currentField = '';
  let currentRow = [];
  let inQuotes = false;

  const pushField = () => {
    currentRow.push(currentField);
    currentField = '';
  };

  const pushRow = () => {
    if (currentRow.length === 0) return;
    rows.push(currentRow);
    currentRow = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentField += '"';
        index += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }

    if (!inQuotes && char === ',') {
      pushField();
      continue;
    }

    if (!inQuotes && (char === '\n' || char === '\r')) {
      if (char === '\r' && nextChar === '\n') {
        index += 1;
      }
      pushField();
      pushRow();
      continue;
    }

    currentField += char;
  }

  pushField();
  pushRow();

  if (rows.length === 0) return [];
  const header = rows.shift().map(value => value.trim());

  return rows
    .filter(row => row.some(value => value.trim().length > 0))
    .map(row => {
      const record = {};
      for (let index = 0; index < header.length; index += 1) {
        record[header[index]] = row[index] ?? '';
      }
      return record;
    });
};

const deriveBrowseCompKey = (password, length) => {
  const digest = createHash('sha256').update(password).digest();
  const output = Buffer.alloc(length);
  for (let index = 0; index < length; index += 1) {
    output[index] = digest[index % digest.length];
  }
  return output;
};

const decryptBrowseCompCiphertext = (ciphertextB64, password) => {
  const encrypted = Buffer.from(ciphertextB64 || '', 'base64');
  const key = deriveBrowseCompKey(password || '', encrypted.length);
  const output = Buffer.alloc(encrypted.length);
  for (let index = 0; index < encrypted.length; index += 1) {
    output[index] = encrypted[index] ^ key[index];
  }
  return output.toString('utf8');
};

const buildBrowseCompPrompt = question =>
  BROWSECOMP_QUERY_TEMPLATE.replace('{Question}', String(question || '').trim());

const extractBrowseCompExactAnswer = responseText => {
  const text = typeof responseText === 'string' ? responseText : '';
  const match = text.match(/(?:^|\n)\s*Exact Answer:\s*([\s\S]*?)(?:\n\s*Confidence:|$)/i);
  if (!match || typeof match[1] !== 'string') return '';
  return match[1].trim();
};

const extractBrowseCompConfidence = responseText => {
  const text = typeof responseText === 'string' ? responseText : '';
  const match = text.match(/(?:^|\n)\s*Confidence:\s*([^\n]+)/i);
  return match && typeof match[1] === 'string' ? match[1].trim() : '';
};

const buildBrowseCompJudgePrompt = ({ question, correctAnswer, response }) =>
  BROWSECOMP_GRADER_TEMPLATE.replace('{question}', question)
    .replace('{correct_answer}', correctAnswer)
    .replace('{response}', response);

const normalizeComparableAnswer = value =>
  String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();

const compareBrowseCompAnswersPreview = (expected, actual) => {
  const normalizedExpected = normalizeComparableAnswer(expected);
  const normalizedActual = normalizeComparableAnswer(actual);
  if (!normalizedExpected || !normalizedActual) return false;
  if (normalizedExpected === normalizedActual) return true;

  const expectedNumber = Number(normalizedExpected);
  const actualNumber = Number(normalizedActual);
  if (Number.isFinite(expectedNumber) && Number.isFinite(actualNumber)) {
    const tolerance = Math.max(1e-9, Math.abs(expectedNumber) * 1e-6);
    return Math.abs(expectedNumber - actualNumber) <= tolerance;
  }

  return false;
};

const normalizeSetupMessages = rawValue => {
  if (!Array.isArray(rawValue)) return [];

  return rawValue
    .map(entry => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
      const role = typeof entry.role === 'string' ? entry.role.trim() : '';
      const content = typeof entry.content === 'string' ? entry.content : '';
      if (!role || !content.trim()) return null;
      return {
        role,
        content,
        ...(entry.awaitEmotionAnalysis === true || entry.await_emotion_analysis === true
          ? { awaitEmotionAnalysis: true }
          : {}),
      };
    })
    .filter(Boolean);
};

const normalizeExperimentalContext = rawValue => {
  if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) {
    return null;
  }

  const affectMode =
    rawValue.affectMode === 'no_affect' ||
    rawValue.affectMode === 'tone_only' ||
    rawValue.affectMode === 'explicit_policy'
      ? rawValue.affectMode
      : rawValue.affect_mode === 'no_affect' ||
          rawValue.affect_mode === 'tone_only' ||
          rawValue.affect_mode === 'explicit_policy'
        ? rawValue.affect_mode
        : null;
  const contextMode =
    rawValue.contextMode === 'default' || rawValue.contextMode === 'benchmark_clean'
      ? rawValue.contextMode
      : rawValue.context_mode === 'default' || rawValue.context_mode === 'benchmark_clean'
        ? rawValue.context_mode
        : null;
  const awaitRealtimeAffect =
    rawValue.awaitRealtimeAffect === true || rawValue.await_realtime_affect === true;

  if (!affectMode && !contextMode && !awaitRealtimeAffect) {
    return null;
  }

  return {
    ...(affectMode ? { affectMode } : {}),
    ...(contextMode ? { contextMode } : {}),
    ...(awaitRealtimeAffect ? { awaitRealtimeAffect } : {}),
  };
};

const normalizeTask = (task, index) => {
  if (!task || typeof task !== 'object' || Array.isArray(task)) {
    throw new Error(`Task ${index + 1} is not a valid object`);
  }

  const rawId =
    (typeof task.id === 'string' && task.id.trim()) ||
    (typeof task.task_id === 'string' && task.task_id.trim()) ||
    (typeof task.sample_id === 'string' && task.sample_id.trim()) ||
    `task_${index + 1}`;

  const messages = Array.isArray(task.messages) ? task.messages : null;
  const prompt =
    typeof task.prompt === 'string'
      ? task.prompt
      : typeof task.question === 'string'
        ? task.question
        : '';

  if ((!messages || messages.length === 0) && !prompt.trim()) {
    throw new Error(`Task "${rawId}" must define prompt or messages`);
  }

  return {
    id: rawId,
    prompt: prompt.trim(),
    messages:
      messages && messages.length > 0
        ? messages
        : [{ role: 'user', content: prompt.trim() }],
    expectedAnswer:
      typeof task.expectedAnswer === 'string'
        ? task.expectedAnswer
        : typeof task.expected_answer === 'string'
          ? task.expected_answer
          : '',
    scoring:
      task.scoring && typeof task.scoring === 'object' && !Array.isArray(task.scoring)
        ? task.scoring
        : null,
    tools: Array.isArray(task.tools) ? task.tools.filter(value => typeof value === 'string') : null,
    setupMessages: normalizeSetupMessages(task.setupMessages ?? task.setup_messages),
    experimentalContext: normalizeExperimentalContext(
      task.experimentalContext ?? task.experimental_context
    ),
    metadata:
      task.metadata && typeof task.metadata === 'object' && !Array.isArray(task.metadata)
        ? task.metadata
        : null,
  };
};

const loadTasksFromFile = async tasksPath => {
  const absolutePath = path.resolve(tasksPath);
  const raw = await fsp.readFile(absolutePath, 'utf8');

  if (absolutePath.endsWith('.jsonl')) {
    return raw
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .map((line, index) => normalizeTask(JSON.parse(line), index));
  }

  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) {
    return parsed.map((task, index) => normalizeTask(task, index));
  }

  if (parsed && typeof parsed === 'object' && Array.isArray(parsed.tasks)) {
    return parsed.tasks.map((task, index) => normalizeTask(task, index));
  }

  throw new Error('Task file must be a JSON array, JSON object with tasks[], or JSONL');
};

const loadBrowseCompOfficialTasks = async ({ datasetUrl }) => {
  const response = await fetch(datasetUrl || BROWSECOMP_OFFICIAL_DATASET_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch BrowseComp dataset (${response.status})`);
  }

  const csvText = await response.text();
  const rows = parseCsvRecords(csvText);
  return rows.map((row, index) => {
    const canary = typeof row.canary === 'string' ? row.canary : '';
    const question = decryptBrowseCompCiphertext(row.problem || '', canary);
    const expectedAnswer = decryptBrowseCompCiphertext(row.answer || '', canary);
    return normalizeTask(
      {
        id:
          (typeof row.id === 'string' && row.id.trim()) ||
          (typeof row.problem_id === 'string' && row.problem_id.trim()) ||
          `browsecomp_${index + 1}`,
        prompt: buildBrowseCompPrompt(question),
        expectedAnswer,
        scoring: {
          type: 'browsecomp-preview',
        },
        tools: ['web', 'fetch'],
        metadata: {
          benchmark: 'browsecomp',
          source: 'official',
          question,
        },
      },
      index
    );
  });
};

const loadTasks = async options => {
  const benchmark = options.benchmark.trim().toLowerCase();
  if (benchmark === 'browsecomp' && !options.tasksPath) {
    return await loadBrowseCompOfficialTasks({
      datasetUrl: options.browsecompUrl,
    });
  }

  return await loadTasksFromFile(options.tasksPath);
};

const buildHeaders = ({ clientId, clientToken, extraHeaders }) => ({
  Authorization: `Bearer ${clientToken}`,
  'X-Iki-Client': clientId,
  ...(extraHeaders || {}),
});

const requestJson = async (url, options = {}) => {
  const response = await fetch(url, options);
  let payload = null;
  const text = await response.text();
  if (text.trim()) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }
  }
  return { response, payload };
};

const waitForDaemonHealth = async ({ daemonUrl, timeoutMs }) => {
  const start = Date.now();
  let lastError = null;
  while (Date.now() - start < timeoutMs) {
    try {
      const { response, payload } = await requestJson(`${daemonUrl}/v1/health`);
      if (response.ok && payload && payload.success) {
        return payload;
      }
      lastError = new Error(`Health check returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }
  throw new Error(
    `Timed out waiting for daemon health check after ${timeoutMs}ms` +
      (lastError ? `: ${String(lastError.message || lastError)}` : '')
  );
};

const registerClient = async ({ daemonUrl, clientName, bootstrapToken, allowedTools }) => {
  const { response, payload } = await requestJson(`${daemonUrl}/v1/clients/register`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-iki-setup-token': bootstrapToken,
    },
    body: JSON.stringify({
      name: clientName || 'iKi Benchmark Harness',
      scopes: ['chat:read', 'chat:write', 'tools:run', 'tools:approve'],
      allowed_tools: allowedTools,
    }),
  });

  if (!response.ok || !payload?.success || !payload.client_id || !payload.token) {
    throw new Error(
      `Failed to register daemon client (${response.status}): ${JSON.stringify(payload)}`
    );
  }

  return {
    clientId: payload.client_id,
    clientToken: payload.token,
  };
};

const createThread = async ({ daemonUrl, clientId, clientToken, title, model }) => {
  const { response, payload } = await requestJson(`${daemonUrl}/v1/chat/threads`, {
    method: 'POST',
    headers: {
      ...buildHeaders({ clientId, clientToken }),
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      title,
      model,
    }),
  });

  if (!response.ok || !payload?.success || !payload.thread?.id) {
    throw new Error(`Failed to create thread (${response.status}): ${JSON.stringify(payload)}`);
  }

  return payload.thread;
};

const getThread = async ({ daemonUrl, clientId, clientToken, threadId }) => {
  const { response, payload } = await requestJson(
    `${daemonUrl}/v1/chat/threads/${encodeURIComponent(threadId)}`,
    {
      headers: buildHeaders({ clientId, clientToken }),
    }
  );

  if (!response.ok || !payload?.success || !payload.thread?.id) {
    throw new Error(`Failed to load thread (${response.status}): ${JSON.stringify(payload)}`);
  }

  return payload.thread;
};

const createMessage = async ({
  daemonUrl,
  clientId,
  clientToken,
  threadId,
  role,
  content,
  timestamp,
  metadata,
  awaitEmotionAnalysis = false,
}) => {
  const { response, payload } = await requestJson(`${daemonUrl}/v1/chat/messages`, {
    method: 'POST',
    headers: {
      ...buildHeaders({ clientId, clientToken }),
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      thread_id: threadId,
      role,
      content,
      ...(typeof timestamp === 'string' && timestamp.trim() ? { timestamp } : {}),
      ...(metadata && typeof metadata === 'object' ? { metadata } : {}),
      ...(awaitEmotionAnalysis ? { await_emotion_analysis: true } : {}),
    }),
  });

  if (!response.ok || !payload?.success || !payload.message?.id) {
    throw new Error(`Chat message create failed (${response.status}): ${JSON.stringify(payload)}`);
  }

  return payload.message;
};

const sendChat = async ({
  daemonUrl,
  clientId,
  clientToken,
  providerType,
  model,
  messages,
  tools,
  skillMode,
  threadId,
}) => {
  const { response, payload } = await requestJson(`${daemonUrl}/v1/chat/send`, {
    method: 'POST',
    headers: {
      ...buildHeaders({ clientId, clientToken }),
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      providerType,
      model,
      messages,
      ...(Array.isArray(tools) ? { tools } : {}),
      ...(typeof skillMode === 'string' ? { skillMode } : {}),
      ...(typeof threadId === 'string' && threadId.trim() ? { thread_id: threadId.trim() } : {}),
    }),
  });

  if (!response.ok || !payload?.success) {
    throw new Error(`Chat send failed (${response.status}): ${JSON.stringify(payload)}`);
  }

  return payload;
};

const sanitizeFileName = value => value.replace(/[^a-zA-Z0-9._-]+/g, '_');

const finalizeAssistantText = chunks => {
  const deltas = [];
  for (const chunk of chunks) {
    if (
      chunk &&
      typeof chunk === 'object' &&
      chunk.type === 'text-delta' &&
      typeof chunk.delta === 'string'
    ) {
      deltas.push(chunk.delta);
    }
  }
  return deltas.join('');
};

const resolvePredictionText = ({ chunks, daemonResult }) => {
  const streamedText = finalizeAssistantText(chunks);
  if (streamedText) return streamedText;

  if (
    daemonResult &&
    typeof daemonResult === 'object' &&
    typeof daemonResult.text === 'string' &&
    daemonResult.text.trim()
  ) {
    return daemonResult.text;
  }

  return '';
};

const scorePrediction = async ({
  task,
  prediction,
  benchmark,
  judgeProviderType,
  judgeModel,
  daemonContext,
}) => {
  const expected = task.expectedAnswer.trim();
  if (!expected) return null;

  const scoring = task.scoring || {};
  const scoringType =
    typeof scoring.type === 'string' && scoring.type.trim()
      ? scoring.type.trim().toLowerCase()
      : 'exact';

  if (benchmark === 'browsecomp' || scoringType === 'browsecomp-preview') {
    const extractedAnswer = extractBrowseCompExactAnswer(prediction);
    const extractedConfidence = extractBrowseCompConfidence(prediction);

    if (judgeProviderType && judgeModel && daemonContext) {
      const judgePrompt = buildBrowseCompJudgePrompt({
        question:
          (task.metadata &&
            typeof task.metadata === 'object' &&
            typeof task.metadata.question === 'string' &&
            task.metadata.question) ||
          task.prompt,
        correctAnswer: expected,
        response: prediction,
      });

      const judgeResult = await sendChat({
        daemonUrl: daemonContext.daemonUrl,
        clientId: daemonContext.clientId,
        clientToken: daemonContext.clientToken,
        providerType: judgeProviderType,
        model: judgeModel,
        messages: [{ role: 'user', content: judgePrompt }],
        tools: [],
      });

      const judgeText = typeof judgeResult.text === 'string' ? judgeResult.text : '';
      const correctnessMatch = judgeText.match(/correct:\s*(yes|no)/i);
      return {
        type: 'browsecomp-judge',
        passed: correctnessMatch ? correctnessMatch[1].toLowerCase() === 'yes' : false,
        expected,
        extractedAnswer,
        extractedConfidence,
        judgeModel,
        judgeProviderType,
        judgeText,
      };
    }

    return {
      type: 'browsecomp-preview',
      passed: compareBrowseCompAnswersPreview(expected, extractedAnswer),
      expected,
      extractedAnswer,
      extractedConfidence,
    };
  }

  if (scoringType === 'contains') {
    return {
      type: 'contains',
      passed: prediction.includes(expected),
      expected,
    };
  }

  if (scoringType === 'regex') {
    const flags =
      typeof scoring.flags === 'string' && scoring.flags.trim() ? scoring.flags.trim() : '';
    const regex = new RegExp(expected, flags);
    return {
      type: 'regex',
      passed: regex.test(prediction),
      expected,
      flags,
    };
  }

  return {
    type: 'exact',
    passed: prediction.trim() === expected,
    expected,
  };
};

const streamTask = async ({
  daemonUrl,
  clientId,
  clientToken,
  requestId,
  payload,
  timeoutMs,
  profileLatency = false,
}) =>
  await new Promise((resolve, reject) => {
    const streamStartedAtMs = performance.now();
    const ws = new WebSocket(toWsUrl(daemonUrl), {
      headers: buildHeaders({ clientId, clientToken }),
    });

    const chunks = [];
    const daemonEvents = [];
    let settled = false;
    let ready = false;
    let wsOpenedAtMs = null;
    let readyAtMs = null;
    let startSentAtMs = null;
    let completedAtMs = null;

    const elapsedSinceStreamStart = () => roundDurationMs(performance.now() - streamStartedAtMs) ?? 0;

    const buildProfile = ({ outcome, error = null }) =>
      profileLatency
        ? buildStreamLatencyProfile({
            chunks,
            daemonEvents,
            wsOpenedAtMs,
            readyAtMs,
            startSentAtMs,
            completedAtMs: completedAtMs ?? elapsedSinceStreamStart(),
            outcome,
            error,
          })
        : null;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        ws.close();
      } catch {}
      const error = new Error(`Stream timed out after ${timeoutMs}ms`);
      if (profileLatency) {
        error.streamLatencyProfile = buildProfile({
          outcome: 'timeout',
          error: error.message,
        });
      }
      reject(error);
    }, timeoutMs);

    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      completedAtMs = completedAtMs ?? elapsedSinceStreamStart();
      try {
        ws.close();
      } catch {}
      resolve({
        ...result,
        ...(profileLatency
          ? {
              latencyProfile: buildProfile({
                outcome: 'completed',
              }),
            }
          : {}),
      });
    };

    const fail = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      completedAtMs = completedAtMs ?? elapsedSinceStreamStart();
      try {
        ws.close();
      } catch {}
      if (profileLatency) {
        error.streamLatencyProfile = buildProfile({
          outcome: 'error',
          error: String(error && error.message ? error.message : error),
        });
      }
      reject(error);
    };

    ws.on('open', () => {
      wsOpenedAtMs = elapsedSinceStreamStart();
    });

    ws.on('message', rawData => {
      const receivedAtMs = elapsedSinceStreamStart();
      let parsed;
      try {
        parsed = JSON.parse(String(rawData));
      } catch (error) {
        fail(new Error(`Received non-JSON WebSocket payload: ${String(error.message || error)}`));
        return;
      }

      if (parsed && typeof parsed === 'object' && parsed.channel === 'daemon' && parsed.payload) {
        const daemonPayload =
          profileLatency && isObjectRecord(parsed.payload)
            ? {
                ...parsed.payload,
                receivedAtMs,
              }
            : parsed.payload;
        daemonEvents.push(daemonPayload);
        if (parsed.payload.type === 'ready') {
          ready = true;
          readyAtMs = receivedAtMs;
          startSentAtMs = receivedAtMs;
          ws.send(
            JSON.stringify({
              type: 'start',
              request_id: requestId,
              payload,
            })
          );
          return;
        }

        if (parsed.payload.type === 'error') {
          fail(new Error(parsed.payload.error || 'Daemon stream error'));
          return;
        }

        if (parsed.payload.type === 'stream-result') {
          completedAtMs = receivedAtMs;
          finish({
            daemonResult:
              profileLatency && isObjectRecord(parsed.payload)
                ? {
                    ...parsed.payload,
                    receivedAtMs,
                  }
                : parsed.payload,
            daemonEvents,
            chunks,
          });
          return;
        }

        return;
      }

      if (profileLatency && isObjectRecord(parsed)) {
        chunks.push({
          ...parsed,
          receivedAtMs,
        });
        return;
      }

      chunks.push(parsed);
    });

    ws.on('error', error => {
      fail(error);
    });

    ws.on('close', () => {
      if (!settled && !ready) {
        fail(new Error('WebSocket closed before daemon ready event'));
      } else if (!settled) {
        fail(new Error('WebSocket closed before stream completed'));
      }
    });
  });

const mapWithConcurrency = async ({ items, parallel, worker }) => {
  const results = new Array(items.length);
  let nextIndex = 0;

  const claimNextIndex = () => {
    if (nextIndex >= items.length) return null;
    const claimed = nextIndex;
    nextIndex += 1;
    return claimed;
  };

  const workerCount = Math.max(1, Math.min(items.length, parallel));
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const currentIndex = claimNextIndex();
        if (currentIndex === null) {
          return;
        }
        results[currentIndex] = await worker(items[currentIndex], currentIndex);
      }
    })
  );

  return results;
};

const spawnDaemonProcess = async ({ host, port, userDataPath }) => {
  const daemonScriptPath = path.join(__dirname, '..', 'start-daemon.cjs');
  const child = spawn(process.execPath, [daemonScriptPath], {
    env: {
      ...process.env,
      IKI_USER_DATA_PATH: userDataPath,
      IKI_DAEMON_HOST: host,
      IKI_DAEMON_PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const forward = (stream, label) => {
    stream.on('data', chunk => {
      const text = String(chunk);
      if (!text) return;
      process.stderr.write(`[benchmark-daemon:${label}] ${text}`);
    });
  };

  if (child.stdout) forward(child.stdout, 'stdout');
  if (child.stderr) forward(child.stderr, 'stderr');

  child.on('error', error => {
    process.stderr.write(`[benchmark-daemon:error] ${String(error.message || error)}\n`);
  });

  return child;
};

const writeBenchmarkOutputs = async ({
  outputDir,
  summary,
  taskResults,
  predictions,
  benchmark,
  latencySummary = null,
}) => {
  await fsp.writeFile(
    path.join(outputDir, 'summary.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
    'utf8'
  );
  await fsp.writeFile(
    path.join(outputDir, 'results.json'),
    `${JSON.stringify(taskResults, null, 2)}\n`,
    'utf8'
  );
  await fsp.writeFile(
    path.join(outputDir, 'predictions.jsonl'),
    `${predictions.map(entry => JSON.stringify(entry)).join('\n')}\n`,
    'utf8'
  );

  if (benchmark === 'browsecomp') {
    await fsp.writeFile(
      path.join(outputDir, 'browsecomp.predictions.jsonl'),
      `${predictions
        .map(entry =>
          JSON.stringify({
            id: entry.id,
            response: entry.prediction,
            extracted_exact_answer: entry.extractedExactAnswer || '',
            extracted_confidence: entry.extractedConfidence || '',
            error: entry.error || null,
          })
        )
        .join('\n')}\n`,
      'utf8'
    );
  }

  if (latencySummary) {
    await fsp.writeFile(
      path.join(outputDir, 'latency-summary.json'),
      `${JSON.stringify(latencySummary, null, 2)}\n`,
      'utf8'
    );
  }
};

const runBenchmarkTask = async ({
  task,
  taskIndex,
  totalTasks,
  benchmark,
  options,
  daemonContext,
  resolvedTools,
  taskOutputDir,
  taskStartedAtRunMs = null,
  getRunNow = null,
}) => {
  const taskStarted = Date.now();
  const latencyRecorder = options.profileLatency ? createLatencyRecorder() : null;
  const requestId = `${sanitizeFileName(task.id)}_${Date.now()}`;
  let threadId = null;

  try {
    latencyRecorder?.startPhase('threadCreate');
    const thread = await createThread({
      daemonUrl: daemonContext.daemonUrl,
      clientId: daemonContext.clientId,
      clientToken: daemonContext.clientToken,
      title: `[${benchmark}] ${task.id}`,
      model: options.model,
    });
    latencyRecorder?.endPhase('threadCreate');
    threadId = thread.id;

    if (Array.isArray(task.setupMessages) && task.setupMessages.length > 0) {
      latencyRecorder?.startPhase('setupMessages');
      for (const message of task.setupMessages) {
        await createMessage({
          daemonUrl: daemonContext.daemonUrl,
          clientId: daemonContext.clientId,
          clientToken: daemonContext.clientToken,
          threadId: thread.id,
          role: message.role,
          content: message.content,
          awaitEmotionAnalysis: message.awaitEmotionAnalysis === true && message.role === 'user',
        });
      }
      latencyRecorder?.endPhase('setupMessages');
    }

    const streamPayload = {
      providerType: options.providerType,
      model: options.model,
      thread_id: thread.id,
      messages: task.messages,
      ...(typeof options.maxIterations === 'number'
        ? { maxIterations: options.maxIterations }
        : {}),
      ...(resolvedTools.length > 0 ? { tools: resolvedTools } : {}),
      ...(task.tools && task.tools.length > 0 ? { tools: task.tools } : {}),
      ...(options.skillMode ? { skillMode: options.skillMode } : {}),
      ...(task.experimentalContext ? { experimental_context: task.experimentalContext } : {}),
    };

    latencyRecorder?.startPhase('stream');
    const streamResult = await streamTask({
      daemonUrl: daemonContext.daemonUrl,
      clientId: daemonContext.clientId,
      clientToken: daemonContext.clientToken,
      requestId,
      payload: streamPayload,
      timeoutMs: options.streamTimeoutMs,
      profileLatency: options.profileLatency,
    });
    latencyRecorder?.endPhase('stream');

    const prediction = resolvePredictionText({
      chunks: streamResult.chunks,
      daemonResult: streamResult.daemonResult,
    });
    const refreshedThread = await getThread({
      daemonUrl: daemonContext.daemonUrl,
      clientId: daemonContext.clientId,
      clientToken: daemonContext.clientToken,
      threadId: thread.id,
    });
    latencyRecorder?.startPhase('score');
    const score = await scorePrediction({
      task,
      prediction,
      benchmark,
      judgeProviderType: options.judgeProviderType,
      judgeModel: options.judgeModel,
      daemonContext,
    });
    latencyRecorder?.endPhase('score');
    const durationMs = Date.now() - taskStarted;
    const extractedExactAnswer =
      benchmark === 'browsecomp' ? extractBrowseCompExactAnswer(prediction) : '';
    const extractedConfidence =
      benchmark === 'browsecomp' ? extractBrowseCompConfidence(prediction) : '';
    const latencyProfile = latencyRecorder
      ? buildTaskLatencyProfile({
          taskId: task.id,
          recorder: latencyRecorder,
          streamLatencyProfile: streamResult.latencyProfile || null,
          taskStartedAtRunMs,
          taskCompletedAtRunMs: typeof getRunNow === 'function' ? getRunNow() : null,
        })
      : null;

    const taskRecord = {
      id: task.id,
      success: Boolean(streamResult.daemonResult?.success),
      threadId,
      requestId,
      durationMs,
      prediction,
      expectedAnswer: task.expectedAnswer || null,
      score,
      ...(extractedExactAnswer ? { extractedExactAnswer } : {}),
      ...(extractedConfidence ? { extractedConfidence } : {}),
      chunkCount: streamResult.chunks.length,
      daemonResult: streamResult.daemonResult,
      daemonEvents: streamResult.daemonEvents,
      chunks: streamResult.chunks,
      thread: refreshedThread,
      metadata: task.metadata,
      ...(latencyProfile ? { latencyProfile } : {}),
    };

    await fsp.writeFile(
      path.join(taskOutputDir, `${sanitizeFileName(task.id)}.json`),
      `${JSON.stringify(taskRecord, null, 2)}\n`,
      'utf8'
    );

    return {
      taskIndex,
      totalTasks,
      taskRecord,
      predictionRecord: {
        id: task.id,
        prediction,
        ...(extractedExactAnswer ? { extractedExactAnswer } : {}),
        ...(extractedConfidence ? { extractedConfidence } : {}),
      },
      ok: true,
    };
  } catch (error) {
    if (latencyRecorder) {
      const phases = latencyRecorder.snapshot().phases;
      if (phases.score?.startedAtMs !== undefined && phases.score?.endedAtMs === undefined) {
        latencyRecorder.endPhase('score');
      }
      if (phases.stream?.startedAtMs !== undefined && phases.stream?.endedAtMs === undefined) {
        latencyRecorder.endPhase('stream');
      }
      if (
        phases.threadCreate?.startedAtMs !== undefined &&
        phases.threadCreate?.endedAtMs === undefined
      ) {
        latencyRecorder.endPhase('threadCreate');
      }
      if (
        phases.setupMessages?.startedAtMs !== undefined &&
        phases.setupMessages?.endedAtMs === undefined
      ) {
        latencyRecorder.endPhase('setupMessages');
      }
    }
    const durationMs = Date.now() - taskStarted;
    const latencyProfile = latencyRecorder
      ? buildTaskLatencyProfile({
          taskId: task.id,
          recorder: latencyRecorder,
          streamLatencyProfile: error?.streamLatencyProfile || null,
          error: String(error && error.message ? error.message : error),
          taskStartedAtRunMs,
          taskCompletedAtRunMs: typeof getRunNow === 'function' ? getRunNow() : null,
        })
      : null;
    const taskRecord = {
      id: task.id,
      success: false,
      threadId,
      requestId,
      durationMs,
      prediction: '',
      expectedAnswer: task.expectedAnswer || null,
      score: null,
      error: String(error && error.message ? error.message : error),
      metadata: task.metadata,
      ...(latencyProfile ? { latencyProfile } : {}),
    };

    await fsp.writeFile(
      path.join(taskOutputDir, `${sanitizeFileName(task.id)}.json`),
      `${JSON.stringify(taskRecord, null, 2)}\n`,
      'utf8'
    );

    return {
      taskIndex,
      totalTasks,
      taskRecord,
      predictionRecord: {
        id: task.id,
        prediction: '',
        error: taskRecord.error,
      },
      ok: false,
    };
  }
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  const runRecorder = options.profileLatency ? createLatencyRecorder() : null;
  runRecorder?.startPhase('benchmark');
  const benchmark = options.benchmark.trim().toLowerCase() || DEFAULT_BENCHMARK;
  const defaultTools = getDefaultToolsForBenchmark(benchmark);
  const explicitTools = parseList(options.tools);
  const resolvedTools = explicitTools.length > 0 ? explicitTools : defaultTools;

  if (options.spawnDaemon && !options.userDataPath) {
    throw new Error(
      'Benchmark daemon runs require --user-data-path pointing to a preconfigured iKi profile. ' +
        'Spawning a brand-new temporary profile would not include any enabled providers yet.'
    );
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputDir = path.resolve(
    options.outputDir || path.join('benchmark-runs', `${benchmark}-${timestamp}`)
  );
  const taskOutputDir = path.join(outputDir, 'tasks');
  await ensureDir(taskOutputDir);

  runRecorder?.startPhase('loadTasks');
  const allTasks = await loadTasks(options);
  runRecorder?.endPhase('loadTasks');
  const tasks = allTasks.slice(0, Math.min(allTasks.length, options.limit));
  if (tasks.length === 0) {
    throw new Error('No tasks to run after applying --limit');
  }

  let userDataPath = options.userDataPath ? path.resolve(options.userDataPath) : '';
  let daemonChild = null;
  let daemonHost = options.host;
  let daemonPort = Number.isInteger(options.port) ? options.port : null;
  let daemonUrl = options.daemonUrl || '';

  if (options.spawnDaemon) {
    runRecorder?.startPhase('daemonStartup');
    if (userDataPath) {
      await ensureDir(userDataPath);
    }

    if (!daemonPort) {
      daemonPort = await findOpenPort(daemonHost);
    }

    daemonUrl = deriveDaemonUrl({
      host: daemonHost,
      port: daemonPort,
      daemonUrl: options.daemonUrl,
    });

    daemonChild = await spawnDaemonProcess({
      host: daemonHost,
      port: daemonPort,
      userDataPath,
    });
    runRecorder?.endPhase('daemonStartup');
  } else {
    daemonUrl = deriveDaemonUrl({
      daemonUrl: options.daemonUrl,
      host: daemonHost,
      port: daemonPort,
    });
  }

  const cleanup = async () => {
    if (daemonChild && !options.keepDaemon && !daemonChild.killed) {
      daemonChild.kill('SIGTERM');
    }
  };

  process.on('SIGINT', () => {
    void cleanup().finally(() => process.exit(130));
  });
  process.on('SIGTERM', () => {
    void cleanup().finally(() => process.exit(143));
  });

  try {
    runRecorder?.startPhase('healthCheck');
    const health = await waitForDaemonHealth({
      daemonUrl,
      timeoutMs: options.healthTimeoutMs,
    });
    runRecorder?.endPhase('healthCheck');

    runRecorder?.startPhase('resolveClient');
    let clientId = options.clientId || '';
    let clientToken = options.clientToken || '';
    if (!clientId || !clientToken) {
      const bootstrapToken = options.bootstrapToken || (userDataPath ? await readBootstrapToken(userDataPath) : '');
      if (!bootstrapToken) {
        throw new Error(
          'Missing daemon credentials. Provide --client-id and --client-token, or use ' +
            '--spawn-daemon / --user-data-path / --bootstrap-token so the harness can register.'
        );
      }

      const registered = await registerClient({
        daemonUrl,
        bootstrapToken,
        clientName: options.clientName,
        allowedTools: resolvedTools,
      });
      clientId = registered.clientId;
      clientToken = registered.clientToken;
    }
    runRecorder?.endPhase('resolveClient');

    const daemonContext = {
      daemonUrl,
      clientId,
      clientToken,
    };

    const predictionRecords = new Array(tasks.length);
    const taskResults = new Array(tasks.length);
    const startedAt = new Date().toISOString();
    let completedTasks = 0;

    runRecorder?.startPhase('executeTasks');
    await mapWithConcurrency({
      items: tasks,
      parallel: options.parallel,
      worker: async (task, index) => {
        const taskStartedAtRunMs = runRecorder ? runRecorder.now() : null;
        const taskOutcome = await runBenchmarkTask({
          task,
          taskIndex: index,
          totalTasks: tasks.length,
          benchmark,
          options,
          daemonContext,
          resolvedTools,
          taskOutputDir,
          taskStartedAtRunMs,
          getRunNow: runRecorder ? runRecorder.now : null,
        });

        taskResults[index] = taskOutcome.taskRecord;
        predictionRecords[index] = taskOutcome.predictionRecord;
        completedTasks += 1;

        process.stdout.write(
          `[${completedTasks}/${tasks.length}] ${task.id}: ${taskOutcome.ok ? 'ok' : 'failed'} (${taskOutcome.taskRecord.durationMs}ms)\n`
        );

        return taskOutcome;
      },
    });
    runRecorder?.endPhase('executeTasks');

    const finalizedTaskResults = taskResults.filter(Boolean);
    const finalizedPredictions = predictionRecords.filter(Boolean);
    const latencySummary = options.profileLatency
      ? buildLatencyRunSummary(finalizedTaskResults)
      : null;

    const scoredTasks = finalizedTaskResults.filter(
      task => task.score && typeof task.score.passed === 'boolean'
    );
    const passedTasks = scoredTasks.filter(task => task.score.passed);
    const succeededTasks = finalizedTaskResults.filter(task => task.success);
    const summary = {
      benchmark,
      providerType: options.providerType,
      model: options.model,
      ...(options.judgeProviderType && options.judgeModel
        ? {
            judgeProviderType: options.judgeProviderType,
            judgeModel: options.judgeModel,
          }
        : {}),
      daemonUrl,
      daemonHealth: health,
      userDataPath: userDataPath || null,
      tools: resolvedTools,
      ...(typeof options.maxIterations === 'number' ? { maxIterations: options.maxIterations } : {}),
      parallel: options.parallel,
      profileLatency: Boolean(options.profileLatency),
      startedAt,
      finishedAt: new Date().toISOString(),
      totalTasks: finalizedTaskResults.length,
      succeededTasks: succeededTasks.length,
      failedTasks: finalizedTaskResults.length - succeededTasks.length,
      scoredTasks: scoredTasks.length,
      passedTasks: passedTasks.length,
      passRate: scoredTasks.length > 0 ? passedTasks.length / scoredTasks.length : null,
      ...(latencySummary
        ? {
            latencySummaryPath: path.join(outputDir, 'latency-summary.json'),
            flamegraphHtmlPath: path.join(outputDir, 'benchmark-flamegraph.flamegraph.html'),
            traceJsonPath: path.join(outputDir, 'benchmark-flamegraph.trace.json'),
            latencyTopSources: latencySummary.topSources.slice(0, 5),
          }
        : {}),
    };

    runRecorder?.startPhase('writeOutputs');
    await writeBenchmarkOutputs({
      outputDir,
      summary,
      taskResults: finalizedTaskResults,
      predictions: finalizedPredictions,
      benchmark,
      latencySummary,
    });
    if (options.profileLatency) {
      runRecorder.endPhase('writeOutputs');
      runRecorder.endPhase('benchmark');
      await writeTraceArtifacts({
        outputDir,
        basename: 'benchmark-flamegraph',
        ...buildDaemonBenchmarkVisualization({
          benchmark,
          options,
          runProfile: runRecorder.snapshot(),
          taskResults: finalizedTaskResults,
        }),
      });
    } else {
      runRecorder?.endPhase('writeOutputs');
      runRecorder?.endPhase('benchmark');
    }

    process.stdout.write(`Wrote benchmark artifacts to ${outputDir}\n`);
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } finally {
    await cleanup();
  }
};

module.exports = {
  BROWSECOMP_OFFICIAL_DATASET_URL,
  BROWSECOMP_QUERY_TEMPLATE,
  BROWSECOMP_GRADER_TEMPLATE,
  parseArgs,
  parseCsvRecords,
  deriveBrowseCompKey,
  decryptBrowseCompCiphertext,
  buildBrowseCompPrompt,
  extractBrowseCompExactAnswer,
  extractBrowseCompConfidence,
  buildBrowseCompJudgePrompt,
  compareBrowseCompAnswersPreview,
  normalizeTask,
  loadBrowseCompOfficialTasks,
  loadTasks,
  scorePrediction,
  mapWithConcurrency,
  resolvePredictionText,
  buildStreamLatencyProfile,
  buildTaskLatencyProfile,
  buildLatencyRunSummary,
  buildDaemonBenchmarkVisualization,
};

if (require.main === module) {
  void main().catch(error => {
    process.stderr.write(`${String(error && error.stack ? error.stack : error)}\n`);
    process.exit(1);
  });
}
