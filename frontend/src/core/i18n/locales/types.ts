import type { LucideIcon } from "lucide-react";

export interface Translations {
  // Locale meta
  locale: {
    localName: string;
  };

  // Common
  common: {
    home: string;
    settings: string;
    delete: string;
    edit: string;
    rename: string;
    share: string;
    openInNewWindow: string;
    close: string;
    more: string;
    search: string;
    loadMore: string;
    download: string;
    thinking: string;
    artifacts: string;
    public: string;
    custom: string;
    notAvailableInDemoMode: string;
    loading: string;
    version: string;
    all: string;
    lastUpdated: string;
    code: string;
    preview: string;
    cancel: string;
    save: string;
    install: string;
    create: string;
    import: string;
    export: string;
    exportAsMarkdown: string;
    exportAsJSON: string;
    exportSuccess: string;
  };

  home: {
    docs: string;
  };

  // Welcome
  welcome: {
    greeting: string;
    description: string;
    createYourOwnSkill: string;
    createYourOwnSkillDescription: string;
    createCronJob: string;
    createCronJobDescription: string;
  };

  // Clipboard
  clipboard: {
    copyToClipboard: string;
    copiedToClipboard: string;
    failedToCopyToClipboard: string;
    linkCopied: string;
  };

  // Input Box
  inputBox: {
    placeholder: string;
    createSkillPrompt: string;
    createCronPrompt: string;
    addAttachments: string;
    mode: string;
    flashMode: string;
    flashModeDescription: string;
    reasoningMode: string;
    reasoningModeDescription: string;
    proMode: string;
    proModeDescription: string;
    ultraMode: string;
    ultraModeDescription: string;
    reasoningEffort: string;
    reasoningEffortMinimal: string;
    reasoningEffortMinimalDescription: string;
    reasoningEffortLow: string;
    reasoningEffortLowDescription: string;
    reasoningEffortMedium: string;
    reasoningEffortMediumDescription: string;
    reasoningEffortHigh: string;
    reasoningEffortHighDescription: string;
    searchModels: string;
    surpriseMe: string;
    surpriseMePrompt: string;
    followupLoading: string;
    followupConfirmTitle: string;
    followupConfirmDescription: string;
    followupConfirmAppend: string;
    followupConfirmReplace: string;
    suggestions: {
      suggestion: string;
      prompt: string;
      icon: LucideIcon;
    }[];
    suggestionsCreate: (
      | {
          suggestion: string;
          prompt: string;
          icon: LucideIcon;
        }
      | {
          type: "separator";
        }
    )[];
  };

  // Sidebar
  sidebar: {
    recentChats: string;
    newChat: string;
    chats: string;
    demoChats: string;
    agents: string;
    models: string;
    skills: string;
    channels: string;
    mcp: string;
    crons: string;
  };

  // Agents
  agents: {
    title: string;
    description: string;
    newAgent: string;
    emptyTitle: string;
    emptyDescription: string;
    chat: string;
    delete: string;
    deleteConfirm: string;
    deleteSuccess: string;
    newChat: string;
    createPageTitle: string;
    createPageSubtitle: string;
    nameStepTitle: string;
    nameStepHint: string;
    nameStepPlaceholder: string;
    nameStepContinue: string;
    nameStepInvalidError: string;
    nameStepAlreadyExistsError: string;
    nameStepNetworkError: string;
    nameStepCheckError: string;
    nameStepBootstrapMessage: string;
    save: string;
    saving: string;
    saveRequested: string;
    saveHint: string;
    saveCommandMessage: string;
    agentCreatedPendingRefresh: string;
    more: string;
    agentCreated: string;
    startChatting: string;
    backToGallery: string;
  };

  // Breadcrumb
  breadcrumb: {
    workspace: string;
    chats: string;
  };

  // Workspace
  workspace: {
    settingsAndMore: string;
    logout: string;
    userInfo: {
      email: string;
      role: string;
      admin: string;
      user: string;
    };
  };

  // Channels
  channels: {
    title: string;
    description: string;
    enabled: string;
    disabled: string;
    running: string;
    stopped: string;
    configured: string;
    notConfigured: string;
    editConfig: string;
    restart: string;
    restartSuccess: string;
    help: string;
    saveSuccess: string;
    emptyTitle: string;
    emptyDescription: string;
    credentials: string;
    status: string;
    guide: string;
  };

  // MCP
  mcp: {
    title: string;
    description: string;
    addServer: string;
    editServer: string;
    deleteServer: string;
    deleteConfirm: string;
    deleteSuccess: string;
    saveSuccess: string;
    createSuccess: string;
    updateSuccess: string;
    enabled: string;
    disabled: string;
    type: string;
    typeStdio: string;
    typeSse: string;
    typeHttp: string;
    command: string;
    commandHint: string;
    args: string;
    argsHint: string;
    env: string;
    envHint: string;
    url: string;
    urlHint: string;
    headers: string;
    headersHint: string;
    serverDescription: string;
    descriptionHint: string;
    oauth: string;
    oauthEnabled: string;
    oauthTokenUrl: string;
    grantType: string;
    clientId: string;
    clientSecret: string;
    scope: string;
    emptyTitle: string;
    emptyDescription: string;
    guide: string;
    guideIntro: string;
    guideStdioTitle: string;
    guideStdioSteps: string;
    guideSseTitle: string;
    guideSseSteps: string;
    guideLinks: string;
  };

  // Crons
  crons: {
    title: string;
    description: string;
    addJob: string;
    editJob: string;
    deleteJob: string;
    deleteConfirm: string;
    deleteSuccess: string;
    createSuccess: string;
    updateSuccess: string;
    enabled: string;
    disabled: string;
    name: string;
    nameHint: string;
    cron: string;
    cronHint: string;
    cronPlaceholder: string;
    jobDescription: string;
    jobDescriptionHint: string;
    agent: string;
    agentHint: string;
    model: string;
    modelHint: string;
    modelPlaceholder: string;
    prompt: string;
    promptHint: string;
    promptPlaceholder: string;
    emptyTitle: string;
    emptyDescription: string;
    guide: string;
    guideIntro: string;
    guideCronSyntax: string;
    guideCronFormat: string;
    guideExamples: string;
    guideModelNote: string;
    jobCount: string;
    retry: string;
  };

  // Conversation
  conversation: {
    noMessages: string;
    startConversation: string;
  };

  // Chats
  chats: {
    searchChats: string;
  };

  // Page titles (document title)
  pages: {
    appName: string;
    chats: string;
    newChat: string;
    untitled: string;
  };

  // Tool calls
  toolCalls: {
    moreSteps: (count: number) => string;
    lessSteps: string;
    executeCommand: string;
    presentFiles: string;
    needYourHelp: string;
    useTool: (toolName: string) => string;
    searchForRelatedInfo: string;
    searchForRelatedImages: string;
    searchFor: (query: string) => string;
    searchForRelatedImagesFor: (query: string) => string;
    searchOnWebFor: (query: string) => string;
    viewWebPage: string;
    listFolder: string;
    readFile: string;
    writeFile: string;
    clickToViewContent: string;
    writeTodos: string;
    skillInstallTooltip: string;
  };

  // Uploads
  uploads: {
    uploading: string;
    uploadingFiles: string;
  };

  // Subtasks
  subtasks: {
    subtask: string;
    executing: (count: number) => string;
    in_progress: string;
    completed: string;
    failed: string;
  };

  // Token Usage
  tokenUsage: {
    title: string;
    label: string;
    input: string;
    output: string;
    total: string;
    unavailable: string;
    unavailableShort: string;
  };

  // Shortcuts
  shortcuts: {
    searchActions: string;
    noResults: string;
    actions: string;
    keyboardShortcuts: string;
    keyboardShortcutsDescription: string;
    openCommandPalette: string;
    toggleSidebar: string;
  };

  // Models
  models: {
    title: string;
    description: string;
    addModel: string;
    editModel: string;
    deleteModel: string;
    deleteConfirm: string;
    deleteSuccess: string;
    createSuccess: string;
    updateSuccess: string;
    name: string;
    nameHint: string;
    displayName: string;
    provider: string;
    providerHint: string;
    modelId: string;
    modelIdHint: string;
    apiKey: string;
    apiKeyHint: string;
    baseUrl: string;
    baseUrlHint: string;
    maxTokens: string;
    temperature: string;
    requestTimeout: string;
    modelDescription: string;
    modelDescriptionHint: string;
    supportsThinking: string;
    supportsVision: string;
    supportsReasoningEffort: string;
    thinkingEnabled: string;
    thinkingDisabled: string;
    emptyTitle: string;
    emptyDescription: string;
    badJson: string;
  };

  // Settings
  settings: {
    title: string;
    description: string;
    sections: {
      account: string;
      appearance: string;
      memory: string;
      tools: string;
      skills: string;
      notification: string;
      tokenUsage: string;
    };
    memory: {
      title: string;
      description: string;
      empty: string;
      rawJson: string;
      exportButton: string;
      exportSuccess: string;
      importButton: string;
      importConfirmTitle: string;
      importConfirmDescription: string;
      importFileLabel: string;
      importInvalidFile: string;
      importSuccess: string;
      manualFactSource: string;
      addFact: string;
      addFactTitle: string;
      editFactTitle: string;
      addFactSuccess: string;
      editFactSuccess: string;
      clearAll: string;
      clearAllConfirmTitle: string;
      clearAllConfirmDescription: string;
      clearAllSuccess: string;
      factDeleteConfirmTitle: string;
      factDeleteConfirmDescription: string;
      factDeleteSuccess: string;
      factContentLabel: string;
      factCategoryLabel: string;
      factConfidenceLabel: string;
      factContentPlaceholder: string;
      factCategoryPlaceholder: string;
      factConfidenceHint: string;
      factSave: string;
      factValidationContent: string;
      factValidationConfidence: string;
      noFacts: string;
      summaryReadOnly: string;
      memoryFullyEmpty: string;
      factPreviewLabel: string;
      searchPlaceholder: string;
      filterAll: string;
      filterFacts: string;
      filterSummaries: string;
      noMatches: string;
      markdown: {
        overview: string;
        userContext: string;
        work: string;
        personal: string;
        topOfMind: string;
        historyBackground: string;
        recentMonths: string;
        earlierContext: string;
        longTermBackground: string;
        updatedAt: string;
        facts: string;
        empty: string;
        table: {
          category: string;
          confidence: string;
          confidenceLevel: {
            veryHigh: string;
            high: string;
            normal: string;
            unknown: string;
          };
          content: string;
          source: string;
          createdAt: string;
          view: string;
        };
      };
    };
    appearance: {
      themeTitle: string;
      themeDescription: string;
      system: string;
      light: string;
      dark: string;
      systemDescription: string;
      lightDescription: string;
      darkDescription: string;
      languageTitle: string;
      languageDescription: string;
    };
    tools: {
      title: string;
      description: string;
    };
    skills: {
      title: string;
      description: string;
      createSkill: string;
      emptyTitle: string;
      emptyDescription: string;
      emptyButton: string;
    };
    notification: {
      title: string;
      description: string;
      requestPermission: string;
      deniedHint: string;
      testButton: string;
      testTitle: string;
      testBody: string;
      notSupported: string;
      disableNotification: string;
    };
    tokenUsage: {
      title: string;
      description: string;
      summaryTotalTokens: string;
      summaryTotalRuns: string;
      summaryModels: string;
      byModel: string;
      byCaller: string;
      modelColumn: string;
      tokensColumn: string;
      runsColumn: string;
      leadAgent: string;
      subagent: string;
      middleware: string;
      noData: string;
    };
    acknowledge: {
      emptyTitle: string;
      emptyDescription: string;
    };
  };
}
