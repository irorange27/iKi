const fsp = require('node:fs/promises');
const path = require('node:path');

const CATEGORY_COLORS = {
  run: '#1d4ed8',
  wrapper: '#2563eb',
  daemon: '#4338ca',
  phase: '#0f766e',
  task: '#7c3aed',
  stream: '#ea580c',
  model: '#d97706',
  tool: '#059669',
  scoring: '#dc2626',
  io: '#0891b2',
  event: '#64748b',
  default: '#475569',
};

const roundDurationMs = value =>
  Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null;

const escapeHtml = value =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const normalizeSpan = span => {
  const startMs = Number.isFinite(span?.startMs) ? span.startMs : null;
  const durationMs = Number.isFinite(span?.durationMs)
    ? span.durationMs
    : Number.isFinite(span?.endMs) && Number.isFinite(startMs)
      ? span.endMs - startMs
      : null;
  if (!Number.isFinite(startMs) || !Number.isFinite(durationMs) || durationMs < 0) return null;

  return {
    track: String(span.track || 'Track'),
    label: String(span.label || 'span'),
    startMs: roundDurationMs(startMs) ?? 0,
    durationMs: roundDurationMs(durationMs) ?? 0,
    category: String(span.category || 'default'),
    detail: span.detail && typeof span.detail === 'object' ? span.detail : null,
  };
};

const normalizeMarker = marker => {
  const atMs = Number.isFinite(marker?.atMs) ? marker.atMs : null;
  if (!Number.isFinite(atMs)) return null;

  return {
    track: String(marker.track || 'Track'),
    label: String(marker.label || 'marker'),
    atMs: roundDurationMs(atMs) ?? 0,
    category: String(marker.category || 'event'),
    detail: marker.detail && typeof marker.detail === 'object' ? marker.detail : null,
  };
};

const getTrackOrder = ({ spans, markers, tracks = [] }) => {
  const order = [];
  const seen = new Set();
  const push = track => {
    if (!track || seen.has(track)) return;
    seen.add(track);
    order.push(track);
  };

  for (const track of tracks) push(track);
  for (const span of spans) push(span.track);
  for (const marker of markers) push(marker.track);
  return order;
};

const chooseTickMs = totalDurationMs => {
  const rough = Math.max(totalDurationMs / 10, 1);
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalized = rough / magnitude;
  if (normalized <= 1) return 1 * magnitude;
  if (normalized <= 2) return 2 * magnitude;
  if (normalized <= 5) return 5 * magnitude;
  return 10 * magnitude;
};

const formatDetail = detail => {
  if (!detail) return '';
  return JSON.stringify(detail, null, 2);
};

const renderHtml = ({ title, totalDurationMs, spans, markers, metadata, tracks }) => {
  const labelWidth = Math.min(
    360,
    Math.max(
      220,
      tracks.reduce((max, track) => Math.max(max, String(track).length * 8 + 28), 0)
    )
  );
  const timelineWidth = Math.max(1600, Math.min(24000, Math.ceil(totalDurationMs * 0.12)));
  const rowHeight = 24;
  const rowGap = 10;
  const headerHeight = 96;
  const footerHeight = 40;
  const svgHeight = headerHeight + tracks.length * (rowHeight + rowGap) + footerHeight;
  const tickMs = chooseTickMs(totalDurationMs);
  const tickCount = Math.ceil(totalDurationMs / tickMs);

  const trackIndex = new Map(tracks.map((track, index) => [track, index]));
  const trackY = track =>
    headerHeight + (trackIndex.get(track) ?? 0) * (rowHeight + rowGap);
  const scaleX = value => labelWidth + (value / totalDurationMs) * timelineWidth;
  const colorFor = category => CATEGORY_COLORS[category] || CATEGORY_COLORS.default;

  const tickSvg = Array.from({ length: tickCount + 1 }, (_, index) => {
    const atMs = Math.min(totalDurationMs, index * tickMs);
    const x = scaleX(atMs);
    return [
      `<line x1="${x}" y1="${headerHeight - 20}" x2="${x}" y2="${svgHeight - footerHeight}" stroke="#e2e8f0" stroke-width="1" />`,
      `<text x="${x + 4}" y="${headerHeight - 28}" fill="#475569" font-size="11">${escapeHtml(`${roundDurationMs(atMs)} ms`)}</text>`,
    ].join('');
  }).join('\n');

  const trackSvg = tracks.map(track => {
    const y = trackY(track);
    return [
      `<rect x="0" y="${y}" width="${labelWidth - 8}" height="${rowHeight}" fill="#f8fafc" rx="4" />`,
      `<text x="12" y="${y + 16}" fill="#0f172a" font-size="12" font-family="ui-monospace, SFMono-Regular, Menlo, monospace">${escapeHtml(track)}</text>`,
      `<line x1="${labelWidth}" y1="${y + rowHeight + rowGap / 2}" x2="${labelWidth + timelineWidth}" y2="${y + rowHeight + rowGap / 2}" stroke="#f1f5f9" stroke-width="1" />`,
    ].join('\n');
  }).join('\n');

  const spanSvg = spans.map(span => {
    const y = trackY(span.track) + 2;
    const x = scaleX(span.startMs);
    const width = Math.max(1, (span.durationMs / totalDurationMs) * timelineWidth);
    const color = colorFor(span.category);
    const labelText = width >= 72 ? escapeHtml(span.label) : '';
    const tooltip = escapeHtml(
      [
        `${span.label}`,
        `${span.track}`,
        `start: ${span.startMs} ms`,
        `duration: ${span.durationMs} ms`,
        span.detail ? formatDetail(span.detail) : '',
      ]
        .filter(Boolean)
        .join('\n')
    );

    return [
      `<g>`,
      `<rect x="${x}" y="${y}" width="${width}" height="${rowHeight - 4}" rx="4" fill="${color}" opacity="0.92">`,
      `<title>${tooltip}</title>`,
      `</rect>`,
      labelText
        ? `<text x="${x + 6}" y="${y + 14}" fill="#ffffff" font-size="11" font-family="ui-monospace, SFMono-Regular, Menlo, monospace">${labelText}</text>`
        : '',
      `</g>`,
    ].join('');
  }).join('\n');

  const markerSvg = markers.map(marker => {
    const y = trackY(marker.track);
    const x = scaleX(marker.atMs);
    const color = colorFor(marker.category);
    const tooltip = escapeHtml(
      [
        `${marker.label}`,
        `${marker.track}`,
        `at: ${marker.atMs} ms`,
        marker.detail ? formatDetail(marker.detail) : '',
      ]
        .filter(Boolean)
        .join('\n')
    );

    return [
      `<g>`,
      `<line x1="${x}" y1="${y}" x2="${x}" y2="${y + rowHeight}" stroke="${color}" stroke-width="2" stroke-dasharray="3 3">`,
      `<title>${tooltip}</title>`,
      `</line>`,
      `</g>`,
    ].join('');
  }).join('\n');

  const metadataHtml = Object.entries(metadata || {})
    .map(
      ([key, value]) =>
        `<li><strong>${escapeHtml(key)}:</strong> <code>${escapeHtml(
          typeof value === 'string' ? value : JSON.stringify(value)
        )}</code></li>`
    )
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 16px; color: #0f172a; background: #ffffff; }
    h1 { margin: 0 0 8px; font-size: 20px; }
    p, li { font-size: 13px; line-height: 1.5; }
    code { background: #f8fafc; padding: 1px 4px; border-radius: 4px; }
    .legend { display: flex; gap: 12px; flex-wrap: wrap; margin: 12px 0; }
    .legend-item { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: #334155; }
    .legend-swatch { width: 12px; height: 12px; border-radius: 3px; display: inline-block; }
    .meta { margin: 12px 0 18px; padding-left: 18px; }
    .chart { overflow: auto; border: 1px solid #e2e8f0; border-radius: 8px; background: #ffffff; }
    svg text { user-select: none; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <p>Total duration: <code>${escapeHtml(String(roundDurationMs(totalDurationMs) ?? totalDurationMs))} ms</code></p>
  <div class="legend">
    ${Object.entries(CATEGORY_COLORS)
      .filter(([key]) => key !== 'default')
      .map(
        ([key, value]) =>
          `<span class="legend-item"><span class="legend-swatch" style="background:${value}"></span>${escapeHtml(
            key
          )}</span>`
      )
      .join('\n')}
  </div>
  ${metadataHtml ? `<ul class="meta">${metadataHtml}</ul>` : ''}
  <div class="chart">
    <svg width="${labelWidth + timelineWidth + 24}" height="${svgHeight}" viewBox="0 0 ${labelWidth + timelineWidth + 24} ${svgHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="${labelWidth + timelineWidth + 24}" height="${svgHeight}" fill="#ffffff" />
      ${tickSvg}
      ${trackSvg}
      ${spanSvg}
      ${markerSvg}
    </svg>
  </div>
</body>
</html>`;
};

const toTraceEvents = ({ title, spans, markers, tracks, metadata }) => {
  const trackIndex = new Map(tracks.map((track, index) => [track, index + 1]));
  const events = [];

  events.push({
    name: 'process_name',
    ph: 'M',
    pid: 1,
    tid: 0,
    args: { name: title },
  });

  for (const track of tracks) {
    events.push({
      name: 'thread_name',
      ph: 'M',
      pid: 1,
      tid: trackIndex.get(track),
      args: { name: track },
    });
  }

  for (const span of spans) {
    events.push({
      name: span.label,
      cat: span.category,
      ph: 'X',
      pid: 1,
      tid: trackIndex.get(span.track),
      ts: Math.round(span.startMs * 1000),
      dur: Math.max(1, Math.round(span.durationMs * 1000)),
      args: span.detail || {},
    });
  }

  for (const marker of markers) {
    events.push({
      name: marker.label,
      cat: marker.category,
      ph: 'i',
      s: 't',
      pid: 1,
      tid: trackIndex.get(marker.track),
      ts: Math.round(marker.atMs * 1000),
      args: marker.detail || {},
    });
  }

  return {
    traceEvents: events,
    displayTimeUnit: 'ms',
    metadata: metadata || {},
  };
};

const writeTraceArtifacts = async ({
  outputDir,
  basename,
  title,
  totalDurationMs,
  spans = [],
  markers = [],
  metadata = {},
  tracks = [],
}) => {
  const normalizedSpans = spans.map(normalizeSpan).filter(Boolean);
  const normalizedMarkers = markers.map(normalizeMarker).filter(Boolean);
  const orderedTracks = getTrackOrder({
    spans: normalizedSpans,
    markers: normalizedMarkers,
    tracks,
  });
  const normalizedTotalDurationMs =
    roundDurationMs(totalDurationMs) ??
    Math.max(
      1,
      ...normalizedSpans.map(span => span.startMs + span.durationMs),
      ...normalizedMarkers.map(marker => marker.atMs)
    );

  const traceJsonPath = path.join(outputDir, `${basename}.trace.json`);
  const flamegraphHtmlPath = path.join(outputDir, `${basename}.flamegraph.html`);

  const tracePayload = toTraceEvents({
    title,
    spans: normalizedSpans,
    markers: normalizedMarkers,
    tracks: orderedTracks,
    metadata,
  });

  await fsp.writeFile(traceJsonPath, `${JSON.stringify(tracePayload, null, 2)}\n`, 'utf8');
  await fsp.writeFile(
    flamegraphHtmlPath,
    renderHtml({
      title,
      totalDurationMs: normalizedTotalDurationMs,
      spans: normalizedSpans,
      markers: normalizedMarkers,
      metadata,
      tracks: orderedTracks,
    }),
    'utf8'
  );

  return {
    traceJsonPath,
    flamegraphHtmlPath,
  };
};

module.exports = {
  writeTraceArtifacts,
};
