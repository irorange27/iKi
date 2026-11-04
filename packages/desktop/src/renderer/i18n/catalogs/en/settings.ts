import { asCount, asText, TranslationEntry } from '../../shared';

export const settings = {
  'settings.select.placeholder': 'Select an option',
  'settings.select.emptyText': 'No options available.',
  'settings.select.ariaLabel': 'Select an option',
  'settings.menu.general': 'General',
  'settings.menu.models': 'Models & Tools',
  'settings.menu.intelligence': 'Memory & Skills',
  
  'settings.menu.security': 'Security',
  'settings.menu.provider': 'Providers',
  'settings.menu.mcp': 'MCP',
  
  'settings.menu.usage': 'Usage',
  'settings.menu.skills': 'Skills',
  'settings.menu.network': 'Network',
  'settings.menu.ui': 'User Interface',
  'settings.menu.colorScheme': 'Color Scheme',
  'settings.menu.speech': 'Speech',
  
  'settings.fallbackTitle': 'Settings',
  'settings.saved.all': 'All changes saved',
  'settings.saved.unsaved': 'Unsaved changes',
  'settings.footer.close': 'Close',
  'settings.footer.save': 'Save',
  'settings.common.advanced': 'Advanced',
  'settings.general.toolModel.title': 'Tool Model',
  'settings.general.toolModel.description':
    'Used for background AI tasks separate from your main chat model. If you want faster and cheaper runs, choose a fast, lower-cost non-reasoning model.',
  'settings.general.toolModel.select': 'Select Tool Model',
  'settings.general.toolModel.test': 'Test',
  'settings.general.toolModel.testing': 'Testing...',
  'settings.general.toolModel.usedFor':
    'Thread title generation, tool selection, parameter extraction, and other background tasks.',
  'settings.general.toolModel.unconfigured': 'Not configured',
  'settings.general.toolModel.latencyFailed': ({ error }) =>
    `Latency test failed: ${asText(error) || 'Unknown error'}`,
  'settings.general.toolModel.good': ({ time, model }) =>
    `Good. ${asText(time)}s using ${asText(model)}.`,
  'settings.general.toolModel.slow': ({ time, model }) =>
    `Slow. ${asText(time)}s using ${asText(model)}.`,
  'settings.general.toolModel.unusable': ({ time, model }) =>
    `Unusable. ${asText(time)}s using ${asText(model)}.`,
  'settings.general.toolModel.usedForLabel': 'Used for:',
  'settings.general.shellApproval.title': 'Shell Tool Approval',
  'settings.general.shellApproval.description':
    'Shell commands are always manual-only and always require approval before execution.',
  'settings.general.shellApproval.bypassed':
    'Shell approval is currently bypassed because automatic tool approval is enabled below.',
  'settings.general.shellApproval.label': 'Approval Mode',
  'settings.general.shellApproval.alwaysRequired': 'Always Require Approval (Required)',
  'settings.general.language.title': 'Language',
  'settings.general.language.label': 'Language',
  'settings.general.startupBehavior.title': 'Startup Behavior',
  'settings.general.companion.title': 'Companion Pebble',
  'settings.general.companion.description':
    'Control the floating desktop presence layer that reflects iKi state outside the main chat window.',
  'settings.general.companion.enabled': 'Enable floating companion window',
  'settings.general.companion.alwaysOnTop': 'Keep companion above other windows',
  'settings.general.companion.rememberPosition': 'Remember companion position',
  'settings.general.companion.reduceMotion': 'Reduce companion motion',
  'settings.general.companion.openMainWindowOnClick':
    'Open the main chat when the companion is clicked',
  'settings.general.companion.statusOnTitle': 'Companion is enabled',
  'settings.general.companion.statusOnDescription':
    'The desktop pebble should be visible now. If you close it from the pebble itself, come back here to show it again.',
  'settings.general.companion.statusOffTitle': 'Companion is hidden',
  'settings.general.companion.statusOffDescription':
    'The desktop pebble is currently off. Use the button here to bring it back immediately.',
  'settings.general.companion.showNow': 'Show companion now',
  'settings.general.updates.title': 'Automatic Updates',
  'settings.general.updates.description':
    'Packaged Windows and macOS builds can check published GitHub Releases and download updates in the background.',
  'settings.general.updates.loadingDescription':
    'Loading the current updater state from the desktop runtime.',
  'settings.general.updates.checkNow': 'Check Now',
  'settings.general.updates.checking': 'Checking...',
  'settings.general.updates.restartNow': 'Restart to Install',
  'settings.general.updates.unsupportedTitle': 'Automatic updates are unavailable',
  'settings.general.updates.unsupportedPlatform':
    'Automatic downloads currently run only on packaged Windows and macOS builds.',
  'settings.general.updates.unsupportedNotPackaged':
    'Development builds do not expose an update feed. Use a packaged build to verify updates.',
  'settings.general.updates.unsupportedFirstRun':
    'The Windows installer is still finalizing this app launch. Update checks will start on the next launch.',
  'settings.general.updates.unsupportedRepository':
    'The GitHub release repository could not be resolved for this build, so no update feed is available.',
  'settings.general.updates.unsupportedGeneric':
    'This build does not currently expose an update feed.',
  'settings.general.updates.checkingTitle': 'Checking for updates',
  'settings.general.updates.checkingDescription':
    'iKi is contacting the release feed and verifying whether a newer build is available.',
  'settings.general.updates.downloadingTitle': 'Downloading update',
  'settings.general.updates.downloadingDescription':
    'A newer version was found and is now downloading in the background.',
  'settings.general.updates.downloadedTitle': 'Update ready to install',
  'settings.general.updates.downloadedDescription':
    'The new build has been downloaded. Restart iKi now or let it install on the next launch.',
  'settings.general.updates.upToDateTitle': 'You are up to date',
  'settings.general.updates.upToDateDescription':
    'No newer published release was found for this platform and architecture.',
  'settings.general.updates.errorTitle': 'Update check failed',
  'settings.general.updates.errorDescription': ({ error }) =>
    `The update runtime reported: ${asText(error) || 'Unknown error'}`,
  'settings.general.updates.idleAutoTitle': 'Automatic checks are enabled',
  'settings.general.updates.idleAutoDescription': ({ hours }) =>
    `iKi checks on launch and then about every ${asText(hours)} hours.`,
  'settings.general.updates.idleManualTitle': 'Automatic checks are disabled',
  'settings.general.updates.idleManualDescription':
    'Background checks are off, but you can still run a manual check at any time.',
  'settings.general.updates.metaRelease': ({ release }) => `Release: ${asText(release)}`,
  'settings.general.updates.metaLastChecked': ({ time }) => `Last checked: ${asText(time)}`,
  'settings.general.permissionRequests.title': 'Permission Requests',
  'settings.general.permissionRequests.description':
    'Automatically continue tool-enabled turns without waiting for approval prompts.',
  'settings.general.permissionRequests.autoApproveTitle': 'Automatically approve all tool requests',
  'settings.general.permissionRequests.autoApproveDescription':
    'When enabled, built-in and MCP tools continue immediately without waiting for approval prompts, including shell commands.',
  'settings.general.permissionRequests.autoApproveWarning': 'Use with caution.',
  'settings.general.permissionRequests.autoApproveAria': 'Automatically approve all tool requests',
  'settings.general.reset': 'Reset General',
  'settings.general.startMinimized': 'Start Minimized',
  'settings.general.minimizeToTray': 'Minimize To Tray',
  'settings.general.closeToTray': 'Close To Tray',
  'settings.general.autoUpdate': 'Auto Update',
  'settings.general.quickChatHideOnBlur': 'Quick Chat Hide On Blur',
  'settings.ui.fontSize': 'Font Size',
  'settings.ui.chatContentPadding': 'Chat Content Padding',
  'settings.ui.composerPadding': 'Composer Padding',
  'settings.ui.bubbleHorizontalPadding': 'Bubble Horizontal Padding',
  'settings.ui.bubbleVerticalPadding': 'Bubble Vertical Padding',
  'settings.ui.messageGap': 'Message Gap',
  'settings.ui.interfaceDensity': 'Interface Density',
  'settings.ui.compact': 'Compact',
  'settings.ui.comfortable': 'Comfortable',
  'settings.ui.spacious': 'Spacious',
  'settings.ui.reset': 'Reset UI',
  'settings.theme.title': 'Color Scheme',
  'settings.theme.description':
    'Pick a theme preset, search the gallery, or design your own Base46-powered interface.',
  'settings.theme.currentPreset': 'Current preset',
  'settings.theme.searchPlaceholder': 'Search themes...',
  'settings.theme.customTitle': 'Custom Themes',
  'settings.theme.customDescription':
    'Create, edit, and manage your own Base46-derived color schemes.',
  'settings.theme.create': 'Create Theme',
  'settings.theme.emptyCustomInitial': 'No custom themes yet. Click "Create Theme" to get started.',
  'settings.theme.emptyCustomSearch': 'No custom themes match your search.',
  'settings.theme.builtinDescription':
    'Built-in presets that resolve through the same semantic renderer token pipeline.',
  'settings.theme.emptyBuiltinSearch': 'No built-in themes match your search.',
  'settings.theme.reset': 'Reset Color Scheme',
  'settings.theme.gallery.light': 'Light Theme Gallery',
  'settings.theme.gallery.dark': 'Dark Theme Gallery',
  'settings.theme.badge.custom': 'Custom',
  'settings.theme.action.edit': 'Edit',
  'settings.theme.action.delete': 'Delete',
  'settings.theme.meta.bothVariants': 'Light + Dark variants',
  'settings.theme.meta.onlyVariant': ({ variant }) => `${asText(variant)} only`,
  'settings.theme.defaultPresetLabel': 'iKi Default',
  'settings.theme.modal.editTitle': 'Edit Custom Theme',
  'settings.theme.modal.createTitle': 'Create Custom Theme',
  'settings.theme.modal.subtitle':
    'Design your own color scheme with guided Base46 controls and a live preview.',
  'settings.theme.modal.displayName': 'Display Name',
  'settings.theme.modal.displayNamePlaceholder': 'Ocean',
  'settings.theme.modal.type': 'Type',
  'settings.theme.modal.typeAria': 'Theme variant',
  'settings.theme.modal.simple': 'Simple',
  'settings.theme.modal.advanced': 'Advanced',
  'settings.theme.modal.simpleHelp':
    'Pick 4 colors and iKi will generate a complete theme for you.',
  'settings.theme.modal.advancedHelp':
    'Fine-tune the core palette and iKi will derive the remaining Base46 fields.',
  'settings.theme.modal.footnoteSimple': 'Switch to Advanced mode to fine-tune individual colors.',
  'settings.theme.modal.footnoteAdvanced':
    'Advanced mode edits the core palette while iKi derives the remaining Base46 fields for consistency.',
  'settings.theme.preview.title': 'Preview',
  'settings.theme.preview.untitled': 'Untitled Theme',
  'settings.theme.preview.selectedItem': 'Selected Item',
  'settings.theme.preview.menuItem1': 'Menu Item 1',
  'settings.theme.preview.menuItem2': 'Menu Item 2',
  'settings.theme.preview.cardTitle': 'Card Title',
  'settings.theme.preview.cardCopy': 'This is muted text content.',
  'settings.theme.preview.primary': 'Primary',
  'settings.theme.preview.secondary': 'Secondary',
  'settings.theme.preview.delete': 'Delete',
  'settings.theme.error.deleteConfirm': 'Delete this custom theme? This action cannot be undone.',
  'settings.theme.error.displayNameRequired': 'Display name is required.',
  'settings.theme.error.saveFailed': 'Failed to save theme.',
  'settings.theme.field.background.label': 'Background',
  'settings.theme.field.background.hint': 'Main background',
  'settings.theme.field.text.label': 'Text',
  'settings.theme.field.text.hint': 'Primary text',
  'settings.theme.field.accent.label': 'Accent',
  'settings.theme.field.accent.hint': 'Buttons and links',
  'settings.theme.field.secondary.label': 'Secondary',
  'settings.theme.field.secondary.hint': 'Success and info',
  'settings.theme.field.surface.label': 'Surface',
  'settings.theme.field.surface.hint': 'Cards and panels',
  'settings.theme.field.surfaceAlt.label': 'Surface Alt',
  'settings.theme.field.surfaceAlt.hint': 'Nested chrome',
  'settings.theme.field.hover.label': 'Hover',
  'settings.theme.field.hover.hint': 'Hover or active surfaces',
  'settings.theme.field.muted.label': 'Muted',
  'settings.theme.field.muted.hint': 'Secondary text',
  'settings.theme.field.warning.label': 'Warning',
  'settings.theme.field.warning.hint': 'Warnings',
  'settings.theme.field.danger.label': 'Danger',
  'settings.theme.field.danger.hint': 'Destructive actions',
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  'settings.network.proxy.title': 'Proxy',
  'settings.network.proxy.description':
    'Configure a proxy path for web requests when your current network cannot reach the public internet directly.',
  'settings.network.proxy.enable': 'Enable Proxy',
  'settings.network.proxy.type': 'Type',
  'settings.network.proxy.typeAria': 'Proxy Type',
  'settings.network.proxy.host': 'Host',
  'settings.network.proxy.hostPlaceholder': '127.0.0.1',
  'settings.network.proxy.port': 'Port',
  'settings.network.proxy.portPlaceholder': '1080',
  'settings.network.proxy.usernameOptional': 'Username (optional)',
  'settings.network.proxy.usernamePlaceholder': 'proxy-user',
  'settings.network.proxy.passwordOptional': 'Password (optional)',
  'settings.network.proxy.passwordPlaceholder': 'Leave empty when authentication is not required',
  'settings.network.proxy.authHint':
    'Fill in username and password only when your SOCKS5 or HTTP proxy requires authentication.',
  'settings.network.proxy.validationHost': 'Enter a proxy host before running the test.',
  'settings.network.proxy.validationPort': 'Enter a valid proxy port between 1 and 65535.',
  'settings.network.proxy.summaryDirect': 'Direct connection',
  'settings.network.proxy.summaryIncomplete': 'Proxy details incomplete',
  'settings.network.proxy.http': 'HTTP',
  'settings.network.proxy.https': 'HTTPS',
  'settings.network.proxy.socks5': 'SOCKS5',
  'settings.network.webSearch.title': 'Web Search',
  'settings.network.webSearch.description':
    'Choose which public search engine iKi should try first for the built-in web tool.',
  'settings.network.webSearch.engine': 'Preferred Search Engine',
  'settings.network.webSearch.engineAria': 'Preferred Search Engine',
  'settings.network.webSearch.google': 'Google',
  'settings.network.webSearch.duckduckgo': 'DuckDuckGo',
  'settings.network.webSearch.bing': 'Bing',
  'settings.network.webSearch.fallbackHint':
    'The selected engine is tried first. If it fails, iKi falls back to the other built-in engines.',
  'settings.network.diagnostics.title': 'Connection Test',
  'settings.network.diagnostics.description':
    'Run a quick connectivity check with the current network settings before continuing web search work.',
  'settings.network.diagnostics.usesDraft':
    'This test uses the values currently shown here, including edits that have not finished autosaving yet.',
  'settings.network.diagnostics.testing': 'Testing...',
  'settings.network.diagnostics.testAction': 'Test Connection',
  'settings.network.diagnostics.successTitle': 'Network ready',
  'settings.network.diagnostics.partialTitle': 'Partial connectivity',
  'settings.network.diagnostics.failedTitle': 'Connection failed',
  'settings.network.diagnostics.summaryAllPassed': ({ passed, total, route }) =>
    `${asCount(passed)} of ${asCount(total)} checks passed. ${asText(route)}`,
  'settings.network.diagnostics.summaryPartial': ({ passed, total, route }) =>
    `Only ${asCount(passed)} of ${asCount(total)} checks passed. ${asText(route)}`,
  'settings.network.diagnostics.summaryNonePassed': ({ route }) =>
    `No checks passed. ${asText(route)}`,
  'settings.network.diagnostics.routeProxy': ({ proxy }) => `Using ${asText(proxy)}.`,
  'settings.network.diagnostics.routeDirect': 'Using a direct connection.',
  'settings.network.diagnostics.targetInternet': 'General web access',
  'settings.network.diagnostics.targetSearchEngine': ({ engine }) =>
    `${asText(engine)} reachability`,
  'settings.network.diagnostics.reachable': 'Reachable',
  'settings.network.diagnostics.statusCode': ({ code }) => `HTTP ${asText(code)}`,
  'settings.network.diagnostics.duration': ({ ms }) => `${asText(ms)} ms`,
  'settings.network.diagnostics.route': ({ route }) => `Route: ${asText(route)}`,
  'settings.network.timeoutRetryTitle': 'Timeout & Retry',
  'settings.network.timeoutMs': 'Timeout (ms)',
  'settings.network.timeoutHint': 'Controls how long the app waits before timing out.',
  'settings.network.retryAttempts': 'Retry Attempts',
  'settings.network.retryHint': 'Number of retries before a request fails.',
  'settings.network.reset': 'Reset Network',
  'settings.security.dataProtection': 'Data Protection',
  'settings.security.encryptApiKeys': 'Encrypt API Keys',
  'settings.security.requirePassword': 'Require Password',
  'settings.security.sessionTimeout': 'Session Timeout',
  'settings.security.minutes': 'Minutes',
  'settings.security.timeoutHint': 'Shorter timeouts increase security.',
  'settings.security.logging': 'Logging',
  'settings.security.enableLogging': 'Enable Logging',
  'settings.security.level': 'Level',
  'settings.security.levelAria': 'Logging Level',
  'settings.security.logLevel.error': 'Error',
  'settings.security.logLevel.warn': 'Warning',
  'settings.security.logLevel.info': 'Info',
  'settings.security.logLevel.debug': 'Debug',
  'settings.security.reset': 'Reset Security',
  'settings.keybindings.sendMessage': 'Send Message',
  'settings.keybindings.openSettings': 'Open Settings',
  'settings.keybindings.reset': 'Reset Keybindings',
  'settings.speech.inputTitle': 'Speech Input',
  'settings.speech.enable': 'Enable Speech Input',
  'settings.speech.inputDescription':
    'Speech input uses a dedicated speech provider configuration and does not affect your chat model providers.',
  'settings.speech.providerTitle': 'Speech Provider',
  'settings.speech.providerAria': 'Speech provider',
  'settings.speech.apiKey': 'API Key',
  'settings.speech.apiKeyPlaceholder': 'sk-...',
  'settings.speech.baseUrlOptional': 'Base URL (optional)',
  'settings.speech.baseUrlPlaceholder': 'https://api.openai.com/v1',
  'settings.speech.model': 'Model',
  'settings.speech.modelPlaceholder': 'whisper-1',
  'settings.speech.modelName': 'Model Name',
  'settings.speech.modelNamePlaceholder': 'base.en',
  'settings.speech.customModelWarning':
    'This model name is not in the built-in whisper-node list. Set a custom Model Path to use it.',
  'settings.speech.modelPathOptional': 'Model Path (optional)',
  'settings.speech.modelPathPlaceholder': '/path/to/ggml-base.en.bin',
  'settings.speech.downloadBaseUrlOptional': 'Download Base URL (optional)',
  'settings.speech.downloadBaseUrlPlaceholder':
    'https://huggingface.co/ggerganov/whisper.cpp/resolve/main',
  'settings.speech.downloadBaseUrlHelp':
    'Use a mirror if the default download source is unreachable in your network.',
  'settings.speech.customModelPathNotice':
    'Using a custom model path. Clear it to pick from downloaded models below.',
  'settings.speech.downloadModels': 'Download Models',
  'settings.speech.refreshModels': 'Refresh',
  'settings.speech.loadingModels': 'Loading',
  'settings.speech.loadingModelsLong': 'Loading models...',
  'settings.speech.downloadHint':
    'Click "Download & Use" to fetch a model and switch to it automatically. whisper-node requires local model files and a working make toolchain. Large models can take a while to download and compile.',
  'settings.speech.recognitionLanguage': 'Recognition Language',
  'settings.speech.recognitionLanguageAria': 'Recognition language',
  'settings.speech.promptOptional': 'Prompt (optional)',
  'settings.speech.promptPlaceholder': 'Optional hints to improve transcription accuracy',
  'settings.speech.reset': 'Reset Speech',
  'settings.speech.provider.openai': 'OpenAI (Speech)',
  'settings.speech.provider.whisperNode': 'whisper-node (Local)',
  'settings.speech.status.disabledTitle': 'Speech input disabled',
  'settings.speech.status.checkingTitle': 'Checking speech status...',
  'settings.speech.status.readyTitle': 'Speech input ready',
  'settings.speech.status.notReadyTitle': 'Speech input not ready',
  'settings.speech.status.enableToUseVoice': 'Enable speech input to use voice.',
  'settings.speech.status.validating': 'Validating provider, model, and local dependencies.',
  'settings.speech.status.providerModel': ({ provider, model }) =>
    `Provider: ${asText(provider)} | Model: ${asText(model)}`,
  'settings.speech.status.checkSettings': 'Check provider settings and try again.',
  'settings.speech.language.autoDetect': 'Auto Detect',
  'settings.speech.language.custom': ({ value }) => `${asText(value)} (Custom)`,
  'settings.speech.error.serviceUnavailable': 'Speech service unavailable',
  'settings.speech.error.modelListUnavailable': 'Speech model list unavailable',
  'settings.speech.error.loadModelsFailed': ({ error }) =>
    `Failed to load models: ${asText(error)}`,
  'settings.speech.error.downloadUnavailable': 'Model download unavailable',
  'settings.speech.error.downloadFailed': 'Download failed',
  'settings.speech.badge.corrupted': 'Corrupted',
  'settings.speech.action.redownload': 'Re-download',
  'settings.speech.action.selected': 'Selected',
  'settings.speech.action.use': 'Use',
  'settings.speech.action.downloading': 'Downloading',
  'settings.speech.action.compiling': 'Compiling',
  'settings.speech.action.retry': 'Retry',
  'settings.speech.action.downloadAndUse': 'Download & Use',
  'settings.speech.progress.downloadingDetailed': ({ model, progress, detail }) =>
    `Downloading ${asText(model)} · ${asText(progress)}%${asText(detail) ? ` (${asText(detail)})` : ''}`,
  'settings.speech.progress.downloadingSimple': ({ model, size }) =>
    `Downloading ${asText(model)} (${asText(size)} MB)...`,
  'settings.speech.progress.compiling': 'Compiling whisper.cpp (first time only)...',
  'settings.speech.progress.ready': 'Ready to use.',
  'settings.speech.progress.failed': 'Download failed. Please retry.',
  'settings.speech.progress.corrupted': 'Model file corrupted. Re-download recommended.',
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  'settings.usage.title': 'Usage',
  'settings.usage.description':
    'Token usage and estimated spend for model responses generated by chat workflows.',
  'settings.usage.period': 'Period',
  'settings.usage.periodAria': 'Usage period',
  'settings.usage.period.7d': 'Last 7 Days',
  'settings.usage.period.30d': 'Last 30 Days',
  'settings.usage.period.90d': 'Last 90 Days',
  'settings.usage.period.365d': 'Last Year',
  'settings.usage.period.all': 'All Time',
  'settings.usage.loading': 'Loading usage...',
  'settings.usage.totalCost': 'Total Cost',
  'settings.usage.messages': 'Messages',
  'settings.usage.inputTokens': 'Input Tokens',
  'settings.usage.outputTokens': 'Output Tokens',
  'settings.usage.cacheRead': 'Cache Read',
  'settings.usage.cacheWrite': 'Cache Write',
  'settings.usage.heatmapTitle': 'Activity Heatmap',
  'settings.usage.heatmapDescription': 'Token activity over the past year.',
  'settings.usage.loadingHeatmap': 'Loading heatmap...',
  'settings.usage.empty': 'No usage data yet.',
  'settings.usage.heatmapFooter': ({ tokens }) => `${asText(tokens)} tokens in the past year`,
  'settings.usage.heatmapLegend': 'Less ▪▪▪▪ More',
  'settings.usage.heatmapCellTitle': ({ date, tokens, messages }) =>
    `${asText(date)}: ${asText(tokens)} tokens, ${asText(messages)} messages`,
  'settings.usage.costOverTime': 'Cost Over Time',
  'settings.usage.costOverTimeDescription': 'Estimated monthly spend in the selected window.',
  'settings.usage.loadingChart': 'Loading chart...',
  'settings.usage.noCostData': 'No cost data in this period.',
  'settings.usage.monthBarTitle': ({ month, cost }) => `${asText(month)}: ${asText(cost)}`,
  'settings.usage.error.unavailable': 'Usage service unavailable.',
  'settings.usage.error.loadFailed': ({ error }) => `Failed to load usage: ${asText(error)}`,
  'settings.skills.title': 'Skills',
  'settings.skills.availableCount': ({ count }) => `${asCount(count)} skill(s) available`,
  'settings.skills.refreshing': 'Refreshing...',
  'settings.skills.description':
    'Skills are instruction packs loaded from local SKILL.md files. Put your custom skills into the Personal skills folder to make them show up here.',
  'settings.skills.source.personal': 'Personal',
  'settings.skills.source.codex': 'Codex',
  'settings.skills.searchPlaceholder': 'Search skills by name, description, or id...',
  'settings.skills.empty': 'No skills found.',
  'settings.skills.group.personal': 'Personal Skills',
  'settings.skills.group.codex': 'Codex Skills',
  'settings.skills.noDescription': 'No description',
  'settings.skills.viewContent': 'View Content',
  'settings.skills.contentTruncated': 'Content truncated for display.',
  
  
  
  
  
  
  'settings.skills.error.resetUnavailable': 'Workflow reset unavailable.',
  'settings.skills.error.resetFailed': ({ error }) =>
    `Failed to reset workflow data: ${asText(error)}`,
  'settings.skills.error.loadFailed': ({ error }) => `Failed to load skills: ${asText(error)}`,
  'settings.skills.error.openFolderFailed': ({ error }) =>
    `Failed to open skills folder: ${asText(error)}`,
  'settings.skills.error.openSkillFailed': ({ error }) =>
    `Failed to open skill folder: ${asText(error)}`,
  'settings.skills.error.readFailed': ({ error }) =>
    `Failed to read skill content: ${asText(error)}`,
} satisfies Record<string, TranslationEntry>;
