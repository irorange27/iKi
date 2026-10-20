#!/usr/bin/env node
// Accessibility audit for the renderer templates.
//
// Parses every .vue SFC with @vue/compiler-sfc and reports the template-level
// defects a type-check cannot see: interactive elements with no accessible
// name, click handlers with no keyboard parity, form controls whose only name
// is a placeholder, broken ARIA state/parent contracts, positive tabindex and
// aria-hidden on focusable content.
//
// Each element yields at most one finding per rule, and a control that already
// failed the naming rule is not re-reported under a weaker one, so the output
// reads as a fix list rather than a defect tally.
//
// Two opt-out attributes exist. Both are declarative rather than an exception
// list inside this file, so the reason stays next to the markup it describes:
//
//   data-a11y-delegated-click  The element does not act on click itself; it
//       forwards the event to native controls rendered inside it (a markdown
//       copy <button>, say), which already fire on Enter/Space. The container
//       is not a widget and must not become one.
//
//   data-a11y-pointer-alias    A pointer-only duplicate of a control that is
//       already keyboard reachable elsewhere. Requires aria-hidden="true" so
//       assistive tech never meets a control it cannot operate — enforced by
//       the pointer-alias-visible error below.
//
// Anything else must be a real <button>/<a>, or carry role + tabindex +
// keydown so it is operable and announced like one.
//
// Usage:
//   node scripts/a11y_audit.mjs            # human report; exit 1 on errors
//   node scripts/a11y_audit.mjs --json     # machine-readable findings
//
// Pinned as a regression gate by tests/renderer/a11y_audit.test.ts.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@vue/compiler-sfc';

// Anchored to this file so the report is identical whether it runs from the CLI
// (repo root cwd) or from the test runner.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_ROOT = join(REPO_ROOT, 'packages/desktop/src/renderer');

// @vue/compiler-core NodeTypes (the SFC AST is numeric, not string-tagged).
const NODE = {
  ELEMENT: 1,
  TEXT: 2,
  INTERPOLATION: 5,
  SIMPLE_EXPRESSION: 4,
  ATTRIBUTE: 6,
  DIRECTIVE: 7,
};

const NATIVE_INTERACTIVE = new Set(['button', 'a', 'input', 'select', 'textarea', 'summary']);
const FORM_CONTROL = new Set(['input', 'select', 'textarea']);
// Roles that turn a non-native element into an interactive widget.
const WIDGET_ROLES = new Set([
  'button',
  'link',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'switch',
  'checkbox',
  'radio',
  'tab',
  'treeitem',
  'gridcell',
]);
const NAME_REQUIRED_ROLES = new Set(['dialog', 'alertdialog', 'listbox']);
const NAME_EXPECTED_ROLES = new Set(['tablist', 'menu', 'menubar', 'radiogroup', 'toolbar']);

const collect = dir => {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...collect(path));
    else if (path.endsWith('.vue')) out.push(path);
  }
  return out;
};

const getAttr = (node, name) =>
  node.props.find(p => p.type === NODE.ATTRIBUTE && p.name === name);

const hasBoundAttr = (node, name) =>
  node.props.some(
    p =>
      p.type === NODE.DIRECTIVE &&
      (p.name === 'bind' || p.name === 'model') &&
      p.arg?.type === NODE.SIMPLE_EXPRESSION &&
      p.arg.content === name // undefined for v-bind="obj", which never matches // undefined for v-bind="obj", which never matches // undefined for v-bind="obj", which never matches
  );

const hasAny = (node, names) => names.some(n => getAttr(node, n) || hasBoundAttr(node, n));

const eventHandlers = (node, event) =>
  node.props.filter(
    p =>
      p.type === NODE.DIRECTIVE &&
      p.name === 'on' &&
      p.arg?.type === NODE.SIMPLE_EXPRESSION &&
      typeof p.arg.content === 'string' &&
      (p.arg.content === event || p.arg.content.startsWith(`${event}.`))
  );

// `@click.self` on a backdrop or scroll container only dismisses; the control
// that opened it must be a real button, so it is not a control activation.
const hasClick = node =>
  eventHandlers(node, 'click').some(p => !(p.modifiers ?? []).some(m => m.content === 'self'));

const hasKeyHandler = node =>
  ['keydown', 'keyup', 'keypress'].some(e => eventHandlers(node, e).length > 0);

const textContent = node => {
  let text = '';
  for (const child of node.children ?? []) {
    if (child.type === NODE.TEXT) text += child.content;
    else if (child.type === NODE.INTERPOLATION) text += '{expr}';
    else if (child.type === NODE.ELEMENT) text += textContent(child);
  }
  return text.trim();
};

const roleOf = node => (getAttr(node, 'role')?.value?.content ?? '').trim();

// reka-ui's `as-child` merges a wrapper component's props onto its single child
// element (DropdownMenuTrigger and friends), so the DOM really does carry that
// aria-label even though the template attribute sits on the parent.
const asChildWrapper = node =>
  node.__parent?.props?.some(p => p.type === NODE.ATTRIBUTE && p.name === 'as-child')
    ? node.__parent
    : null;

// <label for="x"> targets collected per template.
let labelForIds = new Set();

const labelAncestor = node => {
  let parent = node.__parent;
  while (parent) {
    if (parent.tag === 'label') return parent;
    if (NATIVE_INTERACTIVE.has(parent.tag)) return null;
    parent = parent.__parent;
  }
  return null;
};

// Every distinct way this element can get an accessible name.
const nameSources = node => {
  const sources = new Set();
  for (const attr of ['aria-label', 'aria-labelledby', 'title']) {
    if (hasAny(node, [attr])) sources.add(attr);
  }
  const wrapper = asChildWrapper(node);
  if (wrapper) {
    for (const attr of ['aria-label', 'aria-labelledby', 'title']) {
      if (hasAny(wrapper, [attr])) sources.add(`as-child ${attr}`);
    }
  }
  const label = labelAncestor(node);
  if (label && (textContent(label).length > 0 || hasAny(label, ['aria-label', 'aria-labelledby']))) {
    sources.add('wrapping label');
  }
  const id = getAttr(node, 'id')?.value?.content;
  if (typeof id === 'string' && labelForIds.has(id)) sources.add('label[for]');
  if (textContent(node).length > 0) sources.add('content');
  // An SVG <title>, or a nested <img alt>, also names the control.
  const stack = [...(node.children ?? [])];
  while (stack.length) {
    const child = stack.pop();
    if (child.type !== NODE.ELEMENT) continue;
    if (child.tag === 'img' && hasAny(child, ['alt'])) sources.add('child alt');
    if (hasAny(child, ['aria-label', 'aria-labelledby'])) sources.add('child aria-label');
    if (child.tag === 'title') sources.add('svg title');
    stack.push(...(child.children ?? []));
  }
  return sources;
};

const findings = [];
const report = (file, node, level, rule, message) => {
  findings.push({
    file,
    line: node.loc?.start.line ?? 0,
    column: node.loc?.start.column ?? 0,
    level,
    rule,
    message,
    tag: node.tag ?? '',
  });
};

const registerLabelTargets = ast => {
  labelForIds = new Set();
  const visit = node => {
    if (!node || typeof node !== 'object') return;
    if (node.type === NODE.ELEMENT && node.tag === 'label') {
      const forAttr = getAttr(node, 'for')?.value?.content;
      if (typeof forAttr === 'string' && forAttr.length > 0) labelForIds.add(forAttr);
    }
    for (const child of node.children ?? []) visit(child);
    for (const branch of node.branches ?? []) visit(branch);
  };
  visit(ast);
};

const checkElement = (file, node) => {
  const tag = node.tag;
  const role = roleOf(node);
  const type = getAttr(node, 'type')?.value?.content ?? '';
  const isFormControl = FORM_CONTROL.has(tag) && type !== 'hidden';
  const isInteractive = isFormControl || NATIVE_INTERACTIVE.has(tag) || WIDGET_ROLES.has(role);

  // 1. Interactive elements need an accessible name.
  if (isInteractive) {
    const sources = nameSources(node);
    // A title-only name is a weak fallback — it never appears on keyboard focus —
    // so it stays visible as a warning without inflating the hard failures.
    const strong = [...sources].filter(s => !s.endsWith('title'));
    if (strong.length === 0) {
      if (sources.size > 0) {
        report(
          file,
          node,
          'warning',
          'title-only-name',
          `<${tag}> is named only by its title attribute; add aria-label or visible text`
        );
      } else if (isFormControl && hasAny(node, ['placeholder'])) {
        report(
          file,
          node,
          'error',
          'placeholder-as-label',
          `<${tag}> relies on its placeholder for a name; that text disappears once the field has a value`
        );
      } else {
        report(
          file,
          node,
          'error',
          'control-label',
          `<${tag}> has no accessible name: wrap it in a <label>, or add aria-label/aria-labelledby`
        );
      }
    }
  }

  // 2. A click handler on non-interactive markup must be keyboard reachable —
  //    unless it is pure delegation for controls rendered inside it (a native
  //    <button> inside already fires click on Enter/Space). Such a container
  //    opts out explicitly so the intent is visible at the call site.
  // Two explicit opt-outs, both of which must also keep the element out of the
  // accessibility tree so AT never meets a control it cannot operate:
  //  - delegated: forwards clicks to native controls rendered inside it;
  //  - pointer-alias: duplicates an adjacent keyboard-reachable control and is
  //    only shown by pointer interaction.
  const isDelegation = hasAny(node, ['data-a11y-delegated-click']);
  const isPointerAlias = hasAny(node, ['data-a11y-pointer-alias']);
  if (isPointerAlias && getAttr(node, 'aria-hidden')?.value?.content !== 'true') {
    report(
      file,
      node,
      'error',
      'pointer-alias-visible',
      'data-a11y-pointer-alias requires aria-hidden="true": a pointer-only duplicate must stay out of the accessibility tree'
    );
  }
  if (hasClick(node) && !isInteractive && !isDelegation && !isPointerAlias) {
    if (!hasAny(node, ['tabindex']) || !hasKeyHandler(node)) {
      report(
        file,
        node,
        'error',
        'click-not-keyboard',
        `<${tag}> has @click but is not keyboard reachable: use a <button>, or add role, tabindex and @keydown.enter/.space (mark it data-a11y-delegated-click if it only forwards clicks to native buttons inside)`
      );
    }
  }

  // 3. ARIA state and ownership contracts.
  if (['switch', 'checkbox', 'radio'].includes(role) && !hasAny(node, ['aria-checked'])) {
    report(file, node, 'error', 'aria-state', `role="${role}" requires aria-checked`);
  }
  if (role === 'tab' && !hasAny(node, ['aria-selected'])) {
    report(file, node, 'error', 'aria-state', 'role="tab" requires aria-selected');
  }
  if (role === 'option') {
    if (!hasAny(node, ['aria-selected'])) {
      report(file, node, 'error', 'aria-state', 'role="option" requires aria-selected');
    }
    const parentRole = node.__parent ? roleOf(node.__parent) : '';
    if (parentRole && !['listbox', 'group'].includes(parentRole)) {
      report(
        file,
        node,
        'error',
        'aria-parent',
        `role="option" is owned by role="${parentRole}", expected listbox or group`
      );
    }
  }
  if (NAME_REQUIRED_ROLES.has(role) && !hasAny(node, ['aria-label', 'aria-labelledby'])) {
    report(file, node, 'error', 'aria-name', `role="${role}" requires aria-label or aria-labelledby`);
  }
  if (NAME_EXPECTED_ROLES.has(role) && !hasAny(node, ['aria-label', 'aria-labelledby'])) {
    report(
      file,
      node,
      'warning',
      'aria-name',
      `role="${role}" should carry an accessible name so it is distinguishable in a landmark list`
    );
  }

  // 4. Positive tabindex fights the DOM order.
  const tabindex = getAttr(node, 'tabindex')?.value?.content;
  if (tabindex && Number(tabindex) > 0) {
    report(file, node, 'error', 'tabindex-order', `positive tabindex="${tabindex}" fights DOM order`);
  }

  // 5. aria-hidden="true" hides a Tab stop from AT without removing the stop.
  if (getAttr(node, 'aria-hidden')?.value?.content === 'true' && isInteractive) {
    report(
      file,
      node,
      'error',
      'aria-hidden-focusable',
      'aria-hidden="true" on focusable content creates a Tab stop screen readers cannot announce'
    );
  }

  // 6. Images need a text alternative; alt="" is the valid decorative choice.
  if (tag === 'img' && !hasAny(node, ['alt', 'aria-label', 'aria-labelledby'])) {
    report(file, node, 'error', 'img-alt', '<img> has no alt attribute');
  }
};

// @vue/compiler-sfc does not set parent links; the rules need them, so the walk
// threads the parent through explicitly.
const walkTemplate = (file, node, parent = null) => {
  node.__parent = parent;
  if (node.type === NODE.ELEMENT) {
    checkElement(file, node);
    for (const child of node.children ?? []) walkTemplate(file, child, node);
    return;
  }
  for (const child of node.children ?? []) walkTemplate(file, child, parent);
  for (const branch of node.branches ?? []) walkTemplate(file, branch, parent);
};

export const auditRenderer = (root = DEFAULT_ROOT) => {
  findings.length = 0;
  const files = collect(root).sort();
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const { descriptor, errors } = parse(source, { filename: file });
    if (errors.length) {
      throw new Error(`a11y_audit: failed to parse ${file}: ${errors[0].message}`);
    }
    if (!descriptor.template?.ast) continue;
    registerLabelTargets(descriptor.template.ast);
    walkTemplate(relative(REPO_ROOT, file), descriptor.template.ast);
  }
  return { files, findings: [...findings] };
};

// Only run the CLI when executed directly, so the test can import the auditor.
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const { files, findings: all } = auditRenderer();
  const errors = all.filter(f => f.level === 'error');

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ files: files.length, findings: all }, null, 2));
  } else {
    const grouped = new Map();
    for (const f of all) {
      if (!grouped.has(f.file)) grouped.set(f.file, []);
      grouped.get(f.file).push(f);
    }
    for (const [file, list] of [...grouped.entries()].sort()) {
      console.log(`\n${file}`);
      for (const f of list.sort((a, b) => a.line - b.line)) {
        console.log(
          `  ${f.line}:${f.column}  ${f.level === 'error' ? 'error' : 'warn '}  [${f.rule}] ${f.message}`
        );
      }
    }
    const byRule = new Map();
    for (const f of all) byRule.set(f.rule, (byRule.get(f.rule) ?? 0) + 1);
    console.log('\n--- summary ---');
    for (const [rule, count] of [...byRule.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(count).padStart(3)}  ${rule}`);
    }
    console.log(
      `\n  ${errors.length} error(s), ${all.length - errors.length} warning(s) across ${files.length} templates`
    );
  }

  if (errors.length > 0) process.exitCode = 1;
}
