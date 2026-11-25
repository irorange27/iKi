import { asCount, asText, TranslationEntry } from '../../shared';

export const settings = {
  'settings.select.placeholder': '请选择一项',
  'settings.select.emptyText': '当前没有可选项。',
  'settings.select.ariaLabel': '请选择一项',
  'settings.menu.general': '通用',
  'settings.menu.appearance': '外观与界面',
  'settings.menu.models': '模型与工具',
  'settings.menu.intelligence': '记忆与技能',
  
  'settings.menu.security': '安全',
  'settings.menu.provider': '供应商',
  'settings.menu.mcp': 'MCP',
  'settings.menu.system': '语音与系统',
  
  'settings.menu.usage': '用量',
  'settings.menu.skills': '技能',
  'settings.menu.network': '网络',
  'settings.menu.ui': '界面',
  'settings.menu.colorScheme': '配色',
  'settings.menu.speech': '语音',
  
  'settings.fallbackTitle': '设置',
  'settings.backToChat': '返回',
  'settings.saved.all': '所有更改已保存',
  'settings.saved.unsaved': '有未保存更改',
  'settings.footer.close': '关闭',
  'settings.footer.save': '保存',
  'settings.common.advanced': '高级',
  'settings.general.toolModel.title': '工具模型',
  'settings.general.toolModel.description':
    '用于与你主聊天模型分离的后台 AI 任务。如果你想要更快、更便宜的运行，建议手动选择更快、成本更低的非 reasoning 模型。',
  'settings.general.toolModel.select': '选择工具模型',
  'settings.general.toolModel.test': '测试',
  'settings.general.toolModel.testing': '测试中…',
  'settings.general.toolModel.usedFor':
    '线程标题生成、工具选择、参数提取以及其他后台任务。',
  'settings.general.toolModel.unconfigured': '未配置',
  'settings.general.toolModel.latencyFailed': ({ error }) =>
    `延迟测试失败：${asText(error) || '未知错误'}`,
  'settings.general.toolModel.good': ({ time, model }) =>
    `表现良好。${asText(time)}s，使用 ${asText(model)}。`,
  'settings.general.toolModel.slow': ({ time, model }) =>
    `较慢。${asText(time)}s，使用 ${asText(model)}。`,
  'settings.general.toolModel.unusable': ({ time, model }) =>
    `不可用。${asText(time)}s，使用 ${asText(model)}。`,
  'settings.general.toolModel.usedForLabel': '用途：',
  'settings.general.shellApproval.title': 'Shell 工具审批',
  'settings.general.shellApproval.description': 'Shell 命令始终为人工模式，执行前一定需要批准。',
  'settings.general.shellApproval.bypassed': '由于下方已启用自动工具批准，当前会跳过 Shell 审批。',
  'settings.general.shellApproval.label': '审批模式',
  'settings.general.shellApproval.alwaysRequired': '始终要求批准（必选）',
  'settings.general.language.title': '语言',
  'settings.general.language.label': '语言',
  'settings.general.startupBehavior.title': '启动行为',
  'settings.general.companion.title': '桌宠',
  'settings.general.companion.description':
    '控制桌面上的浮动桌宠外显层，让 iKi 在主聊天窗口之外也能表达当前状态。',
  'settings.general.companion.enabled': '启用浮动桌宠窗口',
  'settings.general.companion.alwaysOnTop': '让桌宠始终置顶',
  'settings.general.companion.rememberPosition': '记住桌宠位置',
  'settings.general.companion.reduceMotion': '降低桌宠动效',
  'settings.general.companion.openMainWindowOnClick': '点击桌宠时打开主聊天窗口',
  'settings.general.companion.statusOnTitle': '桌宠已启用',
  'settings.general.companion.statusOnDescription':
    '桌面上的 pebble 现在应该可见。如果你从桌宠本身把它关掉，可以回到这里重新显示。',
  'settings.general.companion.statusOffTitle': '桌宠当前已隐藏',
  'settings.general.companion.statusOffDescription':
    '桌面 pebble 现在是关闭状态。用这里的按钮可以立刻把它重新打开。',
  'settings.general.companion.showNow': '立即显示桌宠',
  'settings.general.updates.title': '自动更新',
  'settings.general.updates.description':
    '已打包的 Windows 和 macOS 版本可以检查已发布的 GitHub Release，并在后台下载更新。',
  'settings.general.updates.loadingDescription': '正在从桌面运行时读取当前更新状态。',
  'settings.general.updates.checkNow': '立即检查',
  'settings.general.updates.checking': '检查中…',
  'settings.general.updates.restartNow': '重启安装',
  'settings.general.updates.unsupportedTitle': '当前无法自动更新',
  'settings.general.updates.unsupportedPlatform':
    '自动下载目前只在已打包的 Windows 和 macOS 版本中可用。',
  'settings.general.updates.unsupportedNotPackaged':
    '开发模式构建没有更新源。请使用打包后的应用验证更新能力。',
  'settings.general.updates.unsupportedFirstRun':
    'Windows 安装器仍在完成本次首次启动，更新检查会从下次启动开始生效。',
  'settings.general.updates.unsupportedRepository':
    '当前构建无法解析 GitHub 发布仓库，因此没有可用的更新源。',
  'settings.general.updates.unsupportedGeneric': '当前构建暂时没有可用的更新源。',
  'settings.general.updates.checkingTitle': '正在检查更新',
  'settings.general.updates.checkingDescription': 'iKi 正在访问发布通道，确认是否存在更新版本。',
  'settings.general.updates.downloadingTitle': '正在下载更新',
  'settings.general.updates.downloadingDescription': '已发现新版本，正在后台下载。',
  'settings.general.updates.downloadedTitle': '更新已准备安装',
  'settings.general.updates.downloadedDescription':
    '新版本已经下载完成。你可以现在重启 iKi，或在下次启动时完成安装。',
  'settings.general.updates.upToDateTitle': '当前已是最新版本',
  'settings.general.updates.upToDateDescription': '此平台和架构下没有发现更新的已发布版本。',
  'settings.general.updates.errorTitle': '更新检查失败',
  'settings.general.updates.errorDescription': ({ error }) =>
    `更新运行时返回错误：${asText(error) || '未知错误'}`,
  'settings.general.updates.idleAutoTitle': '已启用自动检查',
  'settings.general.updates.idleAutoDescription': ({ hours }) =>
    `iKi 会在启动时检查，并大约每 ${asText(hours)} 小时再次检查一次。`,
  'settings.general.updates.idleManualTitle': '已关闭自动检查',
  'settings.general.updates.idleManualDescription':
    '后台自动检查已关闭，但你仍然可以随时手动检查更新。',
  'settings.general.updates.metaRelease': ({ release }) => `版本：${asText(release)}`,
  'settings.general.updates.metaLastChecked': ({ time }) => `上次检查：${asText(time)}`,
  'settings.general.permissionRequests.title': '权限请求',
  'settings.general.permissionRequests.description':
    '自动继续执行启用了工具的回合，不再等待审批提示。',
  'settings.general.permissionRequests.autoApproveTitle': '自动批准所有工具请求',
  'settings.general.permissionRequests.autoApproveDescription':
    '启用后，内置工具和 MCP 工具会立即继续执行，不再等待审批提示，包括 Shell 命令。',
  'settings.general.permissionRequests.autoApproveWarning': '请谨慎使用。',
  'settings.general.permissionRequests.autoApproveAria': '自动批准所有工具请求',
  'settings.general.reset': '重置通用设置',
  'settings.general.startMinimized': '启动时最小化',
  'settings.general.minimizeToTray': '最小化到托盘',
  'settings.general.closeToTray': '关闭时最小化到托盘',
  'settings.general.autoUpdate': '自动更新',
  'settings.general.quickChatHideOnBlur': '快速聊天失焦时隐藏',
  'settings.ui.fontSize': '字体大小',
  'settings.ui.chatContentPadding': '聊天内容边距',
  'settings.ui.composerPadding': '输入区边距',
  'settings.ui.bubbleHorizontalPadding': '气泡水平内边距',
  'settings.ui.bubbleVerticalPadding': '气泡垂直内边距',
  'settings.ui.messageGap': '消息间距',
  'settings.ui.interfaceDensity': '界面密度',
  'settings.ui.compact': '紧凑',
  'settings.ui.comfortable': '舒适',
  'settings.ui.spacious': '宽松',
  'settings.ui.reset': '重置界面设置',
  'settings.theme.title': '配色',
  'settings.theme.description': '选择主题预设、搜索主题库，或设计你自己的 Base46 配色界面。',
  'settings.theme.currentPreset': '当前预设',
  'settings.theme.searchPlaceholder': '搜索主题…',
  'settings.theme.customTitle': '自定义主题',
  'settings.theme.customDescription': '创建、编辑并管理你自己的 Base46 衍生配色方案。',
  'settings.theme.create': '创建主题',
  'settings.theme.emptyCustomInitial': '还没有自定义主题。点击“创建主题”开始。',
  'settings.theme.emptyCustomSearch': '没有匹配搜索条件的自定义主题。',
  'settings.theme.builtinDescription': '内置预设会经过同一套语义化渲染 token 管线解析。',
  'settings.theme.emptyBuiltinSearch': '没有匹配搜索条件的内置主题。',
  'settings.theme.reset': '重置配色',
  'settings.theme.gallery.light': '浅色主题库',
  'settings.theme.gallery.dark': '深色主题库',
  'settings.theme.badge.custom': '自定义',
  'settings.theme.action.edit': '编辑',
  'settings.theme.action.delete': '删除',
  'settings.theme.meta.bothVariants': '含浅色与深色变体',
  'settings.theme.meta.onlyVariant': ({ variant }) => `仅 ${asText(variant)}`,
  'settings.theme.defaultPresetLabel': 'iKi 默认',
  'settings.theme.modal.editTitle': '编辑自定义主题',
  'settings.theme.modal.createTitle': '创建自定义主题',
  'settings.theme.modal.subtitle': '通过引导式 Base46 控件和实时预览设计你自己的配色方案。',
  'settings.theme.modal.displayName': '显示名称',
  'settings.theme.modal.displayNamePlaceholder': 'Ocean',
  'settings.theme.modal.type': '类型',
  'settings.theme.modal.typeAria': '主题变体',
  'settings.theme.modal.simple': '简单',
  'settings.theme.modal.advanced': '高级',
  'settings.theme.modal.simpleHelp': '只需选择 4 个颜色，iKi 就会为你生成完整主题。',
  'settings.theme.modal.advancedHelp': '微调核心调色板，iKi 会推导出剩余 Base46 字段。',
  'settings.theme.modal.footnoteSimple': '切换到高级模式可微调单独颜色。',
  'settings.theme.modal.footnoteAdvanced':
    '高级模式编辑核心调色板，iKi 会为一致性推导其余 Base46 字段。',
  'settings.theme.preview.title': '预览',
  'settings.theme.preview.untitled': '未命名主题',
  'settings.theme.preview.selectedItem': '已选项目',
  'settings.theme.preview.menuItem1': '菜单项 1',
  'settings.theme.preview.menuItem2': '菜单项 2',
  'settings.theme.preview.cardTitle': '卡片标题',
  'settings.theme.preview.cardCopy': '这是一段弱化文本内容。',
  'settings.theme.preview.primary': '主要',
  'settings.theme.preview.secondary': '次要',
  'settings.theme.preview.delete': '删除',
  'settings.theme.error.deleteConfirm': '删除这个自定义主题？此操作无法撤销。',
  'settings.theme.error.displayNameRequired': '显示名称不能为空。',
  'settings.theme.error.saveFailed': '保存主题失败。',
  'settings.theme.field.background.label': '背景',
  'settings.theme.field.background.hint': '主背景',
  'settings.theme.field.text.label': '文本',
  'settings.theme.field.text.hint': '主文本',
  'settings.theme.field.accent.label': '强调色',
  'settings.theme.field.accent.hint': '按钮与链接',
  'settings.theme.field.secondary.label': '辅助色',
  'settings.theme.field.secondary.hint': '成功与信息态',
  'settings.theme.field.surface.label': '表面层',
  'settings.theme.field.surface.hint': '卡片和面板',
  'settings.theme.field.surfaceAlt.label': '次级表面层',
  'settings.theme.field.surfaceAlt.hint': '嵌套容器',
  'settings.theme.field.hover.label': '悬停',
  'settings.theme.field.hover.hint': '悬停或激活表面',
  'settings.theme.field.muted.label': '弱化文本',
  'settings.theme.field.muted.hint': '次级文本',
  'settings.theme.field.warning.label': '警告',
  'settings.theme.field.warning.hint': '警告态',
  'settings.theme.field.danger.label': '危险',
  'settings.theme.field.danger.hint': '破坏性操作',
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  'settings.network.proxy.title': '代理',
  'settings.network.proxy.description':
    '当当前网络无法直接访问公网时，可以在这里为网页请求配置一条代理链路。',
  'settings.network.proxy.enable': '启用代理',
  'settings.network.proxy.type': '类型',
  'settings.network.proxy.typeAria': '代理类型',
  'settings.network.proxy.host': '主机',
  'settings.network.proxy.hostPlaceholder': '127.0.0.1',
  'settings.network.proxy.port': '端口',
  'settings.network.proxy.portPlaceholder': '1080',
  'settings.network.proxy.usernameOptional': '用户名（可选）',
  'settings.network.proxy.usernamePlaceholder': 'proxy-user',
  'settings.network.proxy.passwordOptional': '密码（可选）',
  'settings.network.proxy.passwordPlaceholder': '如果不需要认证可留空',
  'settings.network.proxy.authHint':
    '只有当你的 SOCKS5 或 HTTP 代理要求鉴权时，才需要填写用户名和密码。',
  'settings.network.proxy.validationHost': '运行测试前请先填写代理主机。',
  'settings.network.proxy.validationPort': '请输入 1 到 65535 之间的有效代理端口。',
  'settings.network.proxy.summaryDirect': '直连',
  'settings.network.proxy.summaryIncomplete': '代理信息未填写完整',
  'settings.network.proxy.http': 'HTTP',
  'settings.network.proxy.https': 'HTTPS',
  'settings.network.proxy.socks5': 'SOCKS5',
  'settings.network.webSearch.title': '网页搜索',
  'settings.network.webSearch.description': '选择 iKi 内置网页搜索工具优先尝试的公开搜索引擎。',
  'settings.network.webSearch.engine': '首选搜索引擎',
  'settings.network.webSearch.engineAria': '首选搜索引擎',
  'settings.network.webSearch.google': 'Google',
  'settings.network.webSearch.duckduckgo': 'DuckDuckGo',
  'settings.network.webSearch.bing': 'Bing',
  'settings.network.webSearch.fallbackHint':
    '会先尝试你选择的引擎；如果失败，iKi 会自动回退到其他内置引擎。',
  'settings.network.diagnostics.title': '连接测试',
  'settings.network.diagnostics.description':
    '在继续网页搜索相关操作之前，先用当前网络设置做一次快速连通性检查。',
  'settings.network.diagnostics.usesDraft':
    '测试会直接使用这里当前显示的值，包括还没完成自动保存的编辑。',
  'settings.network.diagnostics.testing': '测试中…',
  'settings.network.diagnostics.testAction': '测试连接',
  'settings.network.diagnostics.successTitle': '网络已就绪',
  'settings.network.diagnostics.partialTitle': '部分连通',
  'settings.network.diagnostics.failedTitle': '连接失败',
  'settings.network.diagnostics.summaryAllPassed': ({ passed, total, route }) =>
    `${asCount(passed)} / ${asCount(total)} 项检查通过。${asText(route)}`,
  'settings.network.diagnostics.summaryPartial': ({ passed, total, route }) =>
    `仅 ${asCount(passed)} / ${asCount(total)} 项检查通过。${asText(route)}`,
  'settings.network.diagnostics.summaryNonePassed': ({ route }) =>
    `所有检查都未通过。${asText(route)}`,
  'settings.network.diagnostics.routeProxy': ({ proxy }) => `当前使用 ${asText(proxy)}。`,
  'settings.network.diagnostics.routeDirect': '当前使用直连。',
  'settings.network.diagnostics.targetInternet': '通用网页连通性',
  'settings.network.diagnostics.targetSearchEngine': ({ engine }) => `${asText(engine)} 可达性`,
  'settings.network.diagnostics.reachable': '可达',
  'settings.network.diagnostics.statusCode': ({ code }) => `HTTP ${asText(code)}`,
  'settings.network.diagnostics.duration': ({ ms }) => `${asText(ms)} 毫秒`,
  'settings.network.diagnostics.route': ({ route }) => `路由：${asText(route)}`,
  'settings.network.timeoutRetryTitle': '超时与重试',
  'settings.network.timeoutMs': '超时（毫秒）',
  'settings.network.timeoutHint': '控制应用在超时前等待的时长。',
  'settings.network.retryAttempts': '重试次数',
  'settings.network.retryHint': '请求失败前的最大重试次数。',
  'settings.network.reset': '重置网络设置',
  'settings.security.dataProtection': '数据保护',
  'settings.security.encryptApiKeys': '加密 API 密钥',
  'settings.security.requirePassword': '要求密码',
  'settings.security.sessionTimeout': '会话超时',
  'settings.security.minutes': '分钟',
  'settings.security.timeoutHint': '更短的超时时间会提升安全性。',
  'settings.security.logging': '日志',
  'settings.security.enableLogging': '启用日志',
  'settings.security.level': '级别',
  'settings.security.levelAria': '日志级别',
  'settings.security.logLevel.error': '错误',
  'settings.security.logLevel.warn': '警告',
  'settings.security.logLevel.info': '信息',
  'settings.security.logLevel.debug': '调试',
  'settings.security.reset': '重置安全设置',
  'settings.keybindings.sendMessage': '发送消息',
  'settings.keybindings.openSettings': '打开设置',
  'settings.keybindings.reset': '重置快捷键',
  'settings.speech.inputTitle': '语音输入',
  'settings.speech.enable': '启用语音输入',
  'settings.speech.inputDescription':
    '语音输入使用独立的语音 Provider 配置，不会影响你的聊天模型 Provider。',
  'settings.speech.providerTitle': '语音 Provider',
  'settings.speech.providerAria': '语音 Provider',
  'settings.speech.apiKey': 'API Key',
  'settings.speech.apiKeyPlaceholder': 'sk-...',
  'settings.speech.baseUrlOptional': 'Base URL（可选）',
  'settings.speech.baseUrlPlaceholder': 'https://api.openai.com/v1',
  'settings.speech.model': '模型',
  'settings.speech.modelPlaceholder': 'whisper-1',
  'settings.speech.modelName': '模型名称',
  'settings.speech.modelNamePlaceholder': 'base.en',
  'settings.speech.customModelWarning':
    '这个模型名不在内置 whisper-node 列表中。若要使用它，请配置自定义模型路径。',
  'settings.speech.modelPathOptional': '模型路径（可选）',
  'settings.speech.modelPathPlaceholder': '/path/to/ggml-base.en.bin',
  'settings.speech.downloadBaseUrlOptional': '下载 Base URL（可选）',
  'settings.speech.downloadBaseUrlPlaceholder':
    'https://huggingface.co/ggerganov/whisper.cpp/resolve/main',
  'settings.speech.downloadBaseUrlHelp': '如果默认下载源在你的网络环境中不可达，可以改用镜像。',
  'settings.speech.customModelPathNotice':
    '当前正在使用自定义模型路径。清空后可从下方已下载模型中选择。',
  'settings.speech.downloadModels': '下载模型',
  'settings.speech.refreshModels': '刷新',
  'settings.speech.loadingModels': '加载中',
  'settings.speech.loadingModelsLong': '正在加载模型…',
  'settings.speech.downloadHint':
    '点击“下载并使用”即可拉取模型并自动切换。whisper-node 需要本地模型文件以及可用的 make 工具链。大型模型下载和编译可能需要一些时间。',
  'settings.speech.recognitionLanguage': '识别语言',
  'settings.speech.recognitionLanguageAria': '识别语言',
  'settings.speech.promptOptional': '提示词（可选）',
  'settings.speech.promptPlaceholder': '可选提示，用于提升转写准确度',
  'settings.speech.reset': '重置语音设置',
  'settings.speech.provider.openai': 'OpenAI（语音）',
  'settings.speech.provider.whisperNode': 'whisper-node（本地）',
  'settings.speech.status.disabledTitle': '语音输入已关闭',
  'settings.speech.status.checkingTitle': '正在检查语音状态…',
  'settings.speech.status.readyTitle': '语音输入已就绪',
  'settings.speech.status.notReadyTitle': '语音输入未就绪',
  'settings.speech.status.enableToUseVoice': '启用语音输入后才能使用语音功能。',
  'settings.speech.status.validating': '正在校验 Provider、模型与本地依赖。',
  'settings.speech.status.providerModel': ({ provider, model }) =>
    `Provider：${asText(provider)} | 模型：${asText(model)}`,
  'settings.speech.status.checkSettings': '请检查 Provider 设置后重试。',
  'settings.speech.language.autoDetect': '自动识别',
  'settings.speech.language.custom': ({ value }) => `${asText(value)}（自定义）`,
  'settings.speech.error.serviceUnavailable': '语音服务不可用',
  'settings.speech.error.modelListUnavailable': '语音模型列表不可用',
  'settings.speech.error.loadModelsFailed': ({ error }) => `加载模型失败：${asText(error)}`,
  'settings.speech.error.downloadUnavailable': '模型下载不可用',
  'settings.speech.error.downloadFailed': '下载失败',
  'settings.speech.badge.corrupted': '已损坏',
  'settings.speech.action.redownload': '重新下载',
  'settings.speech.action.selected': '已选择',
  'settings.speech.action.use': '使用',
  'settings.speech.action.downloading': '下载中',
  'settings.speech.action.compiling': '编译中',
  'settings.speech.action.retry': '重试',
  'settings.speech.action.downloadAndUse': '下载并使用',
  'settings.speech.progress.downloadingDetailed': ({ model, progress, detail }) =>
    `正在下载 ${asText(model)} · ${asText(progress)}%${asText(detail) ? `（${asText(detail)}）` : ''}`,
  'settings.speech.progress.downloadingSimple': ({ model, size }) =>
    `正在下载 ${asText(model)}（${asText(size)} MB）...`,
  'settings.speech.progress.compiling': '正在编译 whisper.cpp（仅首次需要）...',
  'settings.speech.progress.ready': '已可使用。',
  'settings.speech.progress.failed': '下载失败，请重试。',
  'settings.speech.progress.corrupted': '模型文件已损坏，建议重新下载。',
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  'settings.usage.title': '用量',
  'settings.usage.description': '按聊天工作流统计模型回复的 token 用量与预估花费。',
  'settings.usage.period': '时间范围',
  'settings.usage.periodAria': '用量时间范围',
  'settings.usage.period.7d': '最近 7 天',
  'settings.usage.period.30d': '最近 30 天',
  'settings.usage.period.90d': '最近 90 天',
  'settings.usage.period.365d': '最近一年',
  'settings.usage.period.all': '全部时间',
  'settings.usage.loading': '正在加载用量…',
  'settings.usage.totalCost': '总花费',
  'settings.usage.messages': '消息数',
  'settings.usage.inputTokens': '输入 Token',
  'settings.usage.outputTokens': '输出 Token',
  'settings.usage.cacheRead': '缓存读取',
  'settings.usage.cacheWrite': '缓存写入',
  'settings.usage.heatmapTitle': '活跃热力图',
  'settings.usage.heatmapDescription': '过去一年内的 token 活跃情况。',
  'settings.usage.loadingHeatmap': '正在加载热力图…',
  'settings.usage.empty': '还没有用量数据。',
  'settings.usage.heatmapFooter': ({ tokens }) => `过去一年共 ${asText(tokens)} token`,
  'settings.usage.heatmapLegend': '少 ▪▪▪▪ 多',
  'settings.usage.heatmapCellTitle': ({ date, tokens, messages }) =>
    `${asText(date)}：${asText(tokens)} token，${asText(messages)} 条消息`,
  'settings.usage.costOverTime': '成本趋势',
  'settings.usage.costOverTimeDescription': '所选时间窗口内的月度预估花费。',
  'settings.usage.loadingChart': '正在加载图表…',
  'settings.usage.noCostData': '这个时间段内没有成本数据。',
  'settings.usage.monthBarTitle': ({ month, cost }) => `${asText(month)}：${asText(cost)}`,
  'settings.usage.error.unavailable': '用量服务不可用。',
  'settings.usage.error.loadFailed': ({ error }) => `加载用量失败：${asText(error)}`,
  'settings.skills.title': '技能',
  'settings.skills.availableCount': ({ count }) => `共有 ${asCount(count)} 个技能可用`,
  'settings.skills.refreshing': '刷新中…',
  'settings.skills.description':
    '技能是从本地 SKILL.md 文件加载的指令包。把你的自定义技能放到 Personal skills 文件夹后，它们就会显示在这里。',
  'settings.skills.source.personal': '个人',
  'settings.skills.source.agent': 'Agent',
  'settings.skills.searchPlaceholder': '按名称、描述或 id 搜索技能…',
  'settings.skills.empty': '没有找到技能。',
  'settings.skills.group.personal': '个人技能',
  'settings.skills.group.agent': 'Agent 技能',
  'settings.skills.noDescription': '没有描述',
  'settings.skills.viewContent': '查看内容',
  'settings.skills.contentTruncated': '显示内容已截断。',
  
  
  
  
  
  
  'settings.skills.error.resetUnavailable': '工作流重置功能不可用。',
  'settings.skills.error.resetFailed': ({ error }) => `重置工作流数据失败：${asText(error)}`,
  'settings.skills.error.loadFailed': ({ error }) => `加载技能失败：${asText(error)}`,
  'settings.skills.error.openFolderFailed': ({ error }) => `打开技能文件夹失败：${asText(error)}`,
  'settings.skills.error.openSkillFailed': ({ error }) => `打开技能目录失败：${asText(error)}`,
  'settings.skills.error.readFailed': ({ error }) => `读取技能内容失败：${asText(error)}`,
} satisfies Record<string, TranslationEntry>;
