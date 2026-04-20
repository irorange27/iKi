#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const CHANGELOG_DIR = 'changelogs';
const SECTION_ORDER = ['features', 'fixes', 'optimizations', 'misc'];
const SECTION_TITLES = {
  features: '### 新功能',
  fixes: '### 修复',
  optimizations: '### 优化',
  misc: '### 杂项',
};
const SCOPE_ACRONYMS = new Map([
  ['acp', 'ACP'],
  ['api', 'API'],
  ['ci', 'CI'],
  ['mcp', 'MCP'],
  ['tts', 'TTS'],
  ['ui', 'UI'],
]);

const CONVENTIONAL_SUBJECT_RE =
  /^(?<type>[a-z]+)(?:\((?<scope>[^)]+)\))?(?<breaking>!)?: (?<description>.+)$/i;

const RELEASE_BOOKKEEPING_PATTERNS = [
  /\bchangelog\b/i,
  /\brelease notes?\b/i,
  /\bbump(?:ed)?\b.*\bversion\b/i,
];

const toPosixPath = value => value.replace(/\\/g, '/');

const normalizeVersionTag = value => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('A version value is required.');
  }
  const trimmed = value.trim();
  return trimmed.startsWith('v') ? trimmed : `v${trimmed}`;
};

const normalizeRepoWebUrl = rawValue => {
  if (typeof rawValue !== 'string' || rawValue.trim() === '') return null;
  const trimmed = rawValue.trim();

  if (trimmed.startsWith('git@')) {
    const match = /^git@([^:]+):(.+?)(?:\.git)?$/.exec(trimmed);
    if (!match) return null;
    return `https://${match[1]}/${match[2]}`;
  }

  const normalized = trimmed.replace(/^git\+/, '').replace(/\.git$/, '');
  try {
    const url = new URL(normalized);
    url.hash = '';
    url.search = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
};

const capitalize = value => {
  if (typeof value !== 'string' || value.length === 0) return value;
  return value[0].toUpperCase() + value.slice(1);
};

const humanizeScope = scope =>
  scope
    .split(/[/:._-]+/)
    .filter(Boolean)
    .map(segment => SCOPE_ACRONYMS.get(segment.toLowerCase()) || capitalize(segment))
    .join(' ');

const parseConventionalSubject = subject => {
  if (typeof subject !== 'string') return null;
  const match = CONVENTIONAL_SUBJECT_RE.exec(subject.trim());
  if (!match || !match.groups) return null;

  return {
    type: match.groups.type.toLowerCase(),
    scope: match.groups.scope ? match.groups.scope.trim() : null,
    description: match.groups.description.trim(),
    breaking: match.groups.breaking === '!',
  };
};

const resolveSection = type => {
  switch (type) {
    case 'feat':
      return 'features';
    case 'fix':
      return 'fixes';
    case 'perf':
    case 'refactor':
      return 'optimizations';
    case 'build':
    case 'ci':
    case 'docs':
    case 'style':
    case 'test':
    case 'chore':
    case 'revert':
    default:
      return 'misc';
  }
};

const extractIssueRefs = text => {
  if (typeof text !== 'string' || text.trim() === '') return [];
  const refs = new Set();
  const pattern = /(^|[^\w])#(?<id>\d+)\b/g;
  let match;
  while ((match = pattern.exec(text))) {
    if (match.groups?.id) refs.add(match.groups.id);
  }
  return Array.from(refs);
};

const isReleaseBookkeepingCommit = commit => {
  const parsed = parseConventionalSubject(commit.subject);
  const text = `${commit.subject}\n${commit.body || ''}`;
  if (RELEASE_BOOKKEEPING_PATTERNS.some(pattern => pattern.test(text))) {
    return true;
  }
  if (!parsed) return false;
  if (parsed.type === 'docs' && /release/i.test(parsed.description)) {
    return true;
  }
  if (parsed.type === 'chore' && /\bversion\b/i.test(parsed.description)) {
    return true;
  }
  return false;
};

const buildReferenceSuffix = (commit, repositoryUrl) => {
  if (!repositoryUrl) return '';
  const issueRefs = extractIssueRefs(`${commit.subject}\n${commit.body || ''}`);
  if (issueRefs.length > 0) {
    const links = issueRefs.map(issueId => `[#${issueId}](${repositoryUrl}/issues/${issueId})`);
    return ` (${links.join(', ')})`;
  }
  return ` ([${commit.shortHash}](${repositoryUrl}/commit/${commit.hash}))`;
};

const formatCommitEntry = (commit, repositoryUrl) => {
  const parsed = parseConventionalSubject(commit.subject);
  const referenceSuffix = buildReferenceSuffix(commit, repositoryUrl);

  if (!parsed) {
    return `- ${commit.subject}${referenceSuffix}`;
  }

  const baseText = parsed.scope
    ? `${humanizeScope(parsed.scope)}: ${parsed.description}`
    : capitalize(parsed.description);

  return `- ${baseText}${parsed.breaking ? ' [breaking]' : ''}${referenceSuffix}`;
};

const renderChangelog = ({ entriesBySection, versionTag }) => {
  const bodySections = SECTION_ORDER.filter(section => entriesBySection[section]?.length > 0).map(
    section => `${SECTION_TITLES[section]}\n${entriesBySection[section].join('\n')}`
  );

  if (bodySections.length === 0) {
    bodySections.push(`### 杂项\n- Release ${versionTag}`);
  }

  return `## 更新内容\n\n${bodySections.join('\n\n')}\n`;
};

const readPackageManifest = cwd => {
  const manifestPath = path.join(cwd, 'package.json');
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
};

const runGit = (args, { cwd, allowFailure = false } = {}) => {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    if (allowFailure) return '';
    const stderr = error instanceof Error && 'stderr' in error ? String(error.stderr || '') : '';
    throw new Error(stderr.trim() || `git ${args.join(' ')} failed`);
  }
};

const listMergedTags = ({ cwd, toRef }) => {
  const output = runGit(['tag', '--merged', toRef, '--sort=-version:refname'], { cwd, allowFailure: true });
  return output.split('\n').map(line => line.trim()).filter(Boolean);
};

const resolveStartRefFromMergedTags = ({ versionTag, mergedTags }) => {
  if (mergedTags.length === 0) return null;

  const currentIndex = mergedTags.indexOf(versionTag);
  if (currentIndex >= 0) {
    return mergedTags[currentIndex + 1] || null;
  }

  return mergedTags[0] || null;
};

const resolveStartRef = ({ cwd, versionTag, toRef, explicitFrom }) => {
  if (explicitFrom) return explicitFrom;
  return resolveStartRefFromMergedTags({
    versionTag,
    mergedTags: listMergedTags({ cwd, toRef }),
  });
};

const collectCommits = ({ cwd, fromRef, toRef }) => {
  const rangeArgs =
    fromRef && fromRef.trim() !== ''
      ? [`${fromRef}..${toRef}`]
      : [toRef];

  const raw = runGit(
    ['log', '--no-merges', '--format=%H%x1f%h%x1f%s%x1f%b%x1e', ...rangeArgs],
    { cwd, allowFailure: true }
  );

  return raw
    .split('\x1e')
    .map(record => record.trim())
    .filter(Boolean)
    .map(record => {
      const [hash, shortHash, subject, body = ''] = record.split('\x1f');
      return {
        hash: hash.trim(),
        shortHash: shortHash.trim(),
        subject: subject.trim(),
        body: body.trim(),
      };
    })
    .filter(commit => commit.subject !== '');
};

const resolveRepositoryUrl = ({ cwd, manifest }) => {
  const repositoryField = manifest.repository;
  const manifestUrl =
    typeof repositoryField === 'string' ? repositoryField : repositoryField?.url || null;
  const normalizedManifestUrl = normalizeRepoWebUrl(manifestUrl);
  if (normalizedManifestUrl) return normalizedManifestUrl;

  const remoteUrl = runGit(['config', '--get', 'remote.origin.url'], {
    cwd,
    allowFailure: true,
  });
  return normalizeRepoWebUrl(remoteUrl);
};

const parseArgs = argv => {
  const args = {
    version: null,
    from: null,
    to: 'HEAD',
    output: null,
    dryRun: false,
    force: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];

    switch (token) {
      case '--':
        break;
      case '--version':
        if (!next) throw new Error('Missing value for --version');
        args.version = next;
        index += 1;
        break;
      case '--from':
        if (!next) throw new Error('Missing value for --from');
        args.from = next;
        index += 1;
        break;
      case '--to':
        if (!next) throw new Error('Missing value for --to');
        args.to = next;
        index += 1;
        break;
      case '--output':
        if (!next) throw new Error('Missing value for --output');
        args.output = next;
        index += 1;
        break;
      case '--dry-run':
      case '--stdout':
        args.dryRun = true;
        break;
      case '--force':
        args.force = true;
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
  }

  return args;
};

const buildChangelog = ({
  cwd,
  versionTag,
  fromRef,
  toRef,
  repositoryUrl,
}) => {
  const entriesBySection = {
    features: [],
    fixes: [],
    optimizations: [],
    misc: [],
  };

  const commits = collectCommits({ cwd, fromRef, toRef }).filter(
    commit => !isReleaseBookkeepingCommit(commit)
  );

  for (const commit of commits) {
    const parsed = parseConventionalSubject(commit.subject);
    const section = resolveSection(parsed?.type || 'misc');
    entriesBySection[section].push(formatCommitEntry(commit, repositoryUrl));
  }

  return {
    markdown: renderChangelog({ entriesBySection, versionTag }),
    commitCount: commits.length,
  };
};

const printHelp = () => {
  process.stdout.write(
    [
      'Usage: node scripts/scaffold-changelog.cjs [options]',
      '',
      'Options:',
      '  --version <vX.Y.Z>   Target version tag. Defaults to package.json version.',
      '  --from <git-ref>     Start ref for the changelog range.',
      '  --to <git-ref>       End ref for the changelog range. Defaults to HEAD.',
      '  --output <path>      Output file path. Defaults to changelogs/<version>.md.',
      '  --dry-run            Print the generated changelog instead of writing a file.',
      '  --force              Overwrite an existing changelog file.',
      '  --help               Show this help message.',
      '',
    ].join('\n')
  );
};

const run = () => {
  const cwd = process.cwd();
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const manifest = readPackageManifest(cwd);
  const versionTag = normalizeVersionTag(args.version || manifest.version);
  const outputPath = path.resolve(cwd, args.output || path.join(CHANGELOG_DIR, `${versionTag}.md`));
  const toRef = args.to || 'HEAD';
  const fromRef = resolveStartRef({
    cwd,
    versionTag,
    toRef,
    explicitFrom: args.from,
  });
  const repositoryUrl = resolveRepositoryUrl({ cwd, manifest });
  const { markdown, commitCount } = buildChangelog({
    cwd,
    versionTag,
    fromRef,
    toRef,
    repositoryUrl,
  });

  if (args.dryRun) {
    process.stdout.write(markdown);
    return;
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  if (fs.existsSync(outputPath) && !args.force) {
    throw new Error(`Refusing to overwrite existing changelog: ${toPosixPath(path.relative(cwd, outputPath))}`);
  }

  fs.writeFileSync(outputPath, markdown);
  const relativeOutputPath = toPosixPath(path.relative(cwd, outputPath));
  const resolvedRange = fromRef ? `${fromRef}..${toRef}` : toRef;
  process.stdout.write(
    `Generated ${relativeOutputPath} from ${resolvedRange} (${commitCount} commit${commitCount === 1 ? '' : 's'}).\n`
  );
};

if (require.main === module) {
  try {
    run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  buildChangelog,
  extractIssueRefs,
  formatCommitEntry,
  humanizeScope,
  isReleaseBookkeepingCommit,
  normalizeRepoWebUrl,
  normalizeVersionTag,
  parseConventionalSubject,
  renderChangelog,
  resolveSection,
  resolveStartRefFromMergedTags,
  resolveStartRef,
};
