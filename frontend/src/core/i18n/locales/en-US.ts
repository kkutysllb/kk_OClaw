import {
  CompassIcon,
  GraduationCapIcon,
  ImageIcon,
  MicroscopeIcon,
  PenLineIcon,
  ShapesIcon,
  SparklesIcon,
  VideoIcon,
} from "lucide-react";

import type { Translations } from "./types";

export const enUS: Translations = {
  // Locale meta
  locale: {
    localName: "English",
  },

  // Common
  common: {
    home: "Home",
    settings: "Settings",
    delete: "Delete",
    edit: "Edit",
    rename: "Rename",
    share: "Share",
    openInNewWindow: "Open in new window",
    close: "Close",
    more: "More",
    search: "Search",
    loadMore: "Load more",
    download: "Download",
    thinking: "Thinking",
    artifacts: "Artifacts",
    public: "Public",
    custom: "Custom",
    notAvailableInDemoMode: "Not available in demo mode",
    loading: "Loading...",
    version: "Version",
    all: "All",
    lastUpdated: "Last updated",
    code: "Code",
    preview: "Preview",
    cancel: "Cancel",
    save: "Save",
    install: "Install",
    create: "Create",
    import: "Import",
    export: "Export",
    exportAsMarkdown: "Export as Markdown",
    exportAsJSON: "Export as JSON",
    exportSuccess: "Conversation exported",
  },

  // Home
  home: {
    docs: "Docs",
  },

  // Welcome
  welcome: {
    greeting: "Hello, again!",
    description:
      "Welcome to KKOCLAW, an open source super agent. With built-in and custom skills, KKOCLAW helps you search on the web, analyze data, and generate artifacts like slides, web pages and do almost anything.",

    createYourOwnSkill: "Create Your Own Skill",
    createYourOwnSkillDescription:
      "Create your own skill to release the power of KKOCLAW. With customized skills,\nKKOCLAW can help you search on the web, analyze data, and generate\n artifacts like slides, web pages and do almost anything.",
    createCronJob: "Create Cron Job",
    createCronJobDescription:
      "Describe the cron job you want through conversation. The agent will help you set up the schedule, choose an agent and prompt. For example, generate a daily summary at 9 AM, send weekly reports every Friday, etc.",
  },

  // Clipboard
  clipboard: {
    copyToClipboard: "Copy to clipboard",
    copiedToClipboard: "Copied to clipboard",
    failedToCopyToClipboard: "Failed to copy to clipboard",
    linkCopied: "Link copied to clipboard",
  },

  // Input Box
  inputBox: {
    placeholder: "How can I assist you today?",
    createSkillPrompt:
      "We're going to build a new skill step by step with `skill-creator`. To start, what do you want this skill to do?",
    createCronPrompt:
      "Let's create a scheduled cron job together. Tell me: when should it run and what should it do? For example, generate a daily summary every morning at 9 AM.",
    addAttachments: "Add attachments",
    mode: "Mode",
    flashMode: "Flash",
    flashModeDescription: "Fast and efficient, but may not be accurate",
    reasoningMode: "Reasoning",
    reasoningModeDescription:
      "Reasoning before action, balance between time and accuracy",
    proMode: "Pro",
    proModeDescription:
      "Reasoning, planning and executing, get more accurate results, may take more time",
    ultraMode: "Ultra",
    ultraModeDescription:
      "Pro mode with subagents to divide work; best for complex multi-step tasks",
    reasoningEffort: "Reasoning Effort",
    reasoningEffortMinimal: "Minimal",
    reasoningEffortMinimalDescription: "Retrieval + Direct Output",
    reasoningEffortLow: "Low",
    reasoningEffortLowDescription: "Simple Logic Check + Shallow Deduction",
    reasoningEffortMedium: "Medium",
    reasoningEffortMediumDescription:
      "Multi-layer Logic Analysis + Basic Verification",
    reasoningEffortHigh: "High",
    reasoningEffortHighDescription:
      "Full-dimensional Logic Deduction + Multi-path Verification + Backward Check",
    searchModels: "Search models...",
    surpriseMe: "Surprise",
    surpriseMePrompt: "Surprise me",
    followupLoading: "Generating follow-up questions...",
    followupConfirmTitle: "Send suggestion?",
    followupConfirmDescription:
      "You already have text in the input. Choose how to send it.",
    followupConfirmAppend: "Append & send",
    followupConfirmReplace: "Replace & send",
    suggestions: [
      {
        suggestion: "Write",
        prompt: "Write a blog post about the latest trends on [topic]",
        icon: PenLineIcon,
      },
      {
        suggestion: "Research",
        prompt:
          "Conduct a deep dive research on [topic], and summarize the findings.",
        icon: MicroscopeIcon,
      },
      {
        suggestion: "Collect",
        prompt: "Collect data from [source] and create a report.",
        icon: ShapesIcon,
      },
      {
        suggestion: "Learn",
        prompt: "Learn about [topic] and create a tutorial.",
        icon: GraduationCapIcon,
      },
    ],
    suggestionsCreate: [
      {
        suggestion: "Webpage",
        prompt: "Create a webpage about [topic]",
        icon: CompassIcon,
      },
      {
        suggestion: "Image",
        prompt: "Create an image about [topic]",
        icon: ImageIcon,
      },
      {
        suggestion: "Video",
        prompt: "Create a video about [topic]",
        icon: VideoIcon,
      },
      {
        type: "separator",
      },
      {
        suggestion: "Skill",
        prompt:
          "We're going to build a new skill step by step with `skill-creator`. To start, what do you want this skill to do?",
        icon: SparklesIcon,
      },
    ],
  },

  // Sidebar
  sidebar: {
    newChat: "New chat",
    chats: "Chats",
    recentChats: "Recent chats",
    demoChats: "Demo chats",
    agents: "Agents",
    models: "Models",
    skills: "Skills",
    channels: "Channels",
        mcp: "MCP",
    crons: "Cron Jobs",
    tokenUsage: "Token Usage",
  },

  // Agents
  agents: {
    title: "Agents",
    description:
      "Create and manage custom agents with specialized prompts and capabilities.",
    newAgent: "New Agent",
    emptyTitle: "No custom agents yet",
    emptyDescription:
      "Create your first custom agent with a specialized system prompt.",
    chat: "Chat",
    delete: "Delete",
    deleteConfirm:
      "Are you sure you want to delete this agent? This action cannot be undone.",
    deleteSuccess: "Agent deleted",
    newChat: "New chat",
    createPageTitle: "Design your Agent",
    createPageSubtitle:
      "Describe the agent you want — I'll help you create it through conversation.",
    nameStepTitle: "Name your new Agent",
    nameStepHint:
      "Letters, digits, and hyphens only — stored lowercase (e.g. code-reviewer)",
    nameStepPlaceholder: "e.g. code-reviewer",
    nameStepContinue: "Continue",
    nameStepInvalidError:
      "Invalid name — use only letters, digits, and hyphens",
    nameStepAlreadyExistsError: "An agent with this name already exists",
    nameStepNetworkError:
      "Network request failed — check your network or backend connection",
    nameStepCheckError: "Could not verify name availability — please try again",
    nameStepBootstrapMessage:
      "The new custom agent name is {name}. Let's bootstrap it's **SOUL**.",
    save: "Save agent",
    saving: "Saving agent...",
    saveRequested:
      "Save requested. KKOCLAW is generating and saving an initial version now.",
    saveHint:
      "You can save this agent at any time from the top-right menu, even if this is only a first draft.",
    saveCommandMessage:
      "Please save this custom agent now based on everything we have discussed so far. Treat this as my explicit confirmation to save. If some details are still missing, make reasonable assumptions, generate a concise first SOUL.md in English, and call setup_agent immediately without asking me for more confirmation.",
    agentCreatedPendingRefresh:
      "The agent was created, but KKOCLAW could not load it yet. Please refresh this page in a moment.",
    more: "More actions",
    agentCreated: "Agent created!",
    startChatting: "Start chatting",
    backToGallery: "Back to Gallery",
  },

  // Breadcrumb
  breadcrumb: {
    workspace: "Workspace",
    chats: "Chats",
  },

  // Workspace
  workspace: {
    settingsAndMore: "Settings and more",
    logout: "Log out",
    userInfo: {
      email: "Email",
      role: "Role",
      admin: "Admin",
      user: "User",
    },
  },

  // Channels
  channels: {
    title: "IM Channel Management",
    description: "Manage external messaging platform integrations. Once configured, users can interact with KKOCLAW via Feishu, DingTalk, WeChat, and other IM tools.",
    enabled: "Enabled",
    disabled: "Disabled",
    running: "Running",
    stopped: "Stopped",
    configured: "Credentials Configured",
    notConfigured: "No Credentials",
    editConfig: "Edit Config",
    restart: "Restart",
    restartSuccess: "Channel restarted",
    help: "Setup Guide",
    saveSuccess: "Channel config saved",
    emptyTitle: "No channels configured",
    emptyDescription: "Configure IM channels to let users interact with KKOCLAW via Feishu, DingTalk, and other platforms.",
    credentials: "Credentials",
    status: "Status",
    guide: "Setup Guide",
  },

  // MCP
  mcp: {
    title: "MCP Management",
    description: "Manage Model Context Protocol (MCP) servers to extend KKOCLAW with additional tools and data access capabilities.",
    addServer: "Add Server",
    editServer: "Edit Server",
    deleteServer: "Delete Server",
    deleteConfirm: "Are you sure you want to delete MCP server \"{name}\"? This action cannot be undone.",
    deleteSuccess: "MCP server deleted",
    saveSuccess: "MCP server config saved",
    createSuccess: "MCP server created",
    updateSuccess: "MCP server updated",
    enabled: "Enabled",
    disabled: "Disabled",
    type: "Transport Type",
    typeStdio: "STDIO (local process)",
    typeSse: "SSE (Server-Sent Events)",
    typeHttp: "HTTP (streamable)",
    command: "Command",
    commandHint: "e.g. npx, python, node",
    args: "Arguments",
    argsHint: "One per line, e.g. -y\n@modelcontextprotocol/server-github",
    env: "Environment Variables",
    envHint: "One per line, format: KEY=value (supports $ENV_VAR references)",
    url: "Server URL",
    urlHint: "e.g. https://mcp.example.com/sse",
    headers: "HTTP Headers",
    headersHint: "One per line, format: Header-Name: value",
    serverDescription: "Description",
    descriptionHint: "Briefly describe what this MCP server provides",
    oauth: "OAuth Authentication",
    oauthEnabled: "Enable OAuth",
    oauthTokenUrl: "Token URL",
    grantType: "Grant Type",
    clientId: "Client ID",
    clientSecret: "Client Secret",
    scope: "Scope",
    emptyTitle: "No MCP servers yet",
    emptyDescription: "Add MCP servers to extend KKOCLAW with external tools like GitHub, filesystem, and database access.",
    guide: "Setup Guide",
    guideIntro: "Model Context Protocol (MCP) is an open protocol that enables AI applications to securely access local and remote data sources. By configuring MCP servers, KKOCLAW gains additional tool capabilities such as filesystem access, web search, and database queries.",
    guideStdioTitle: "STDIO Transport",
    guideStdioSteps: "1. Select STDIO type for locally-running MCP servers.\n2. Enter the launch command (e.g. npx, python) and required arguments.\n3. Configure environment variables if needed (e.g. API keys).\n4. After saving, KKOCLAW will automatically start and manage the MCP server process.",
    guideSseTitle: "SSE / HTTP Transport",
    guideSseSteps: "1. Select SSE or HTTP type for remote MCP servers.\n2. Enter the server's SSE or HTTP endpoint URL.\n3. Add authentication headers (e.g. Authorization) if the server requires it.\n4. OAuth 2.0 is supported — configure Token URL for automatic token acquisition and refresh.",
    guideLinks: "Popular MCP Servers",
  },

  // Crons
  crons: {
    title: "Cron Job Management",
    description: "Manage scheduled cron jobs that trigger AI conversations at specified times for automated reports, periodic checks, and more.",
    addJob: "Add Job",
    editJob: "Edit Job",
    deleteJob: "Delete Job",
    deleteConfirm: "Are you sure you want to delete cron job \"{name}\"? This action cannot be undone.",
    deleteSuccess: "Cron job deleted",
    createSuccess: "Cron job created",
    updateSuccess: "Cron job updated",
    enabled: "Enabled",
    disabled: "Disabled",
    name: "Job Name",
    nameHint: "Letters, numbers and hyphens, e.g. daily-summary, weekly-report",
    cron: "Cron Expression",
    cronHint: "6-field format: sec min hour day month weekday, supports * , - / ?",
    cronPlaceholder: "e.g. 0 0 9 * * * (9:00 AM daily)",
    jobDescription: "Description",
    jobDescriptionHint: "Brief description of what this cron job does",
    agent: "Agent",
    agentHint: "Select which agent executes this task",
    model: "Model",
    modelHint: "Select the AI model for this task (leave empty to use default)",
    modelPlaceholder: "Use default model",
    prompt: "Prompt",
    promptHint: "The prompt/message sent to the agent when triggered",
    promptPlaceholder: "e.g. Generate a daily summary based on today's conversations.",
    emptyTitle: "No cron jobs yet",
    emptyDescription: "Create cron jobs to let KKOCLAW run scheduled AI conversations automatically, such as daily summaries and periodic reports.",
    guide: "Help",
    guideIntro: "Cron jobs use cron expressions to schedule AI conversations at specific times. Ideal for daily summaries, periodic data checks, and automated report generation.",
    guideCronSyntax: "Cron Expression Syntax",
    guideCronFormat: "6-field format: second minute hour day month weekday (space-separated)",
    guideExamples: "Common Examples",
    guideModelNote: "When model is left empty, the system default model will be used.",
    jobCount: "jobs",
    retry: "Retry",
  },

  // Conversation
  conversation: {
    noMessages: "No messages yet",
    startConversation: "Start a conversation to see messages here",
  },

  // Chats
  chats: {
    searchChats: "Search chats",
  },

  // Page titles (document title)
  pages: {
    appName: "KKOCLAW",
    chats: "Chats",
    newChat: "New chat",
    untitled: "Untitled",
  },

  // Tool calls
  toolCalls: {
    moreSteps: (count: number) => `${count} more step${count === 1 ? "" : "s"}`,
    lessSteps: "Less steps",
    executeCommand: "Execute command",
    presentFiles: "Present files",
    needYourHelp: "Need your help",
    useTool: (toolName: string) => `Use "${toolName}" tool`,
    searchFor: (query: string) => `Search for "${query}"`,
    searchForRelatedInfo: "Search for related information",
    searchForRelatedImages: "Search for related images",
    searchForRelatedImagesFor: (query: string) =>
      `Search for related images for "${query}"`,
    searchOnWebFor: (query: string) => `Search on the web for "${query}"`,
    viewWebPage: "View web page",
    listFolder: "List folder",
    readFile: "Read file",
    writeFile: "Write file",
    clickToViewContent: "Click to view file content",
    writeTodos: "Update to-do list",
    skillInstallTooltip: "Install skill and make it available to the agent",
  },

  // Subtasks
  uploads: {
    uploading: "Uploading...",
    uploadingFiles: "Uploading files, please wait...",
  },

  subtasks: {
    subtask: "Subtask",
    executing: (count: number) =>
      `Executing ${count === 1 ? "" : count + " "}subtask${count === 1 ? "" : "s in parallel"}`,
    in_progress: "Running subtask",
    completed: "Subtask completed",
    failed: "Subtask failed",
  },

  // Token Usage
  tokenUsage: {
    title: "Token Usage",
    label: "Tokens",
    input: "Input",
    output: "Output",
    total: "Total",
    unavailable:
      "No token usage yet. Usage appears only after a successful model response when the provider returns usage_metadata.",
    unavailableShort: "No usage returned",
  },

  // Shortcuts
  shortcuts: {
    searchActions: "Search actions...",
    noResults: "No results found.",
    actions: "Actions",
    keyboardShortcuts: "Keyboard Shortcuts",
    keyboardShortcutsDescription:
      "Navigate KKOCLAW faster with keyboard shortcuts.",
    openCommandPalette: "Open Command Palette",
    toggleSidebar: "Toggle Sidebar",
  },

  // Models
  models: {
    title: "Models",
    description: "Manage and configure available LLM models.",
    addModel: "Add Model",
    editModel: "Edit Model",
    deleteModel: "Delete Model",
    deleteConfirm: "Are you sure you want to delete model \"{name}\"? This action cannot be undone.",
    deleteSuccess: "Model deleted",
    createSuccess: "Model created",
    updateSuccess: "Model updated",
    name: "Name",
    nameHint: "Unique identifier for the model, e.g. gpt-4",
    displayName: "Display Name",
    provider: "Provider",
    providerHint: "Provider class path, e.g. langchain_openai:ChatOpenAI",
    modelId: "Model ID",
    modelIdHint: "Actual provider model identifier, e.g. gpt-4",
    apiKey: "API Key",
    apiKeyHint: "API key or $ENV_VAR reference, e.g. $OPENAI_API_KEY",
    baseUrl: "Base URL",
    baseUrlHint: "Base URL for the provider API",
    maxTokens: "Max Tokens",
    temperature: "Temperature",
    requestTimeout: "Timeout (seconds)",
    modelDescription: "Description",
    modelDescriptionHint: "Brief description of the model",
    supportsThinking: "Supports Thinking",
    supportsVision: "Supports Vision",
    supportsReasoningEffort: "Supports Reasoning Effort",
    thinkingEnabled: "When Thinking Enabled",
    thinkingDisabled: "When Thinking Disabled",
    emptyTitle: "No models configured yet",
    emptyDescription: "Click \"Add Model\" to add your first model configuration.",
    badJson: "Invalid JSON format",
  },
  settings: {
    title: "Settings",
    description: "Adjust how KKOCLAW looks and behaves for you.",
    sections: {
      account: "Account",
      appearance: "Appearance",
      memory: "Memory",
      tools: "Tools",
      skills: "Skills",
      notification: "Notification",
      tokenUsage: "Token Usage",
    },
    memory: {
      title: "Memory",
      description:
        "KKOCLAW automatically learns from your conversations in the background. These memories help KKOCLAW understand you better and deliver a more personalized experience.",
      empty: "No memory data to display.",
      rawJson: "Raw JSON",
      exportButton: "Export memory",
      exportSuccess: "Memory exported",
      importButton: "Import memory",
      importConfirmTitle: "Import memory?",
      importConfirmDescription:
        "This will overwrite your current memory with the selected JSON backup.",
      importFileLabel: "Selected file",
      importInvalidFile:
        "Failed to read the selected memory file. Please choose a valid JSON export.",
      importSuccess: "Memory imported",
      manualFactSource: "Manual",
      addFact: "Add fact",
      addFactTitle: "Add memory fact",
      editFactTitle: "Edit memory fact",
      addFactSuccess: "Fact created",
      editFactSuccess: "Fact updated",
      clearAll: "Clear all memory",
      clearAllConfirmTitle: "Clear all memory?",
      clearAllConfirmDescription:
        "This will remove all saved summaries and facts. This action cannot be undone.",
      clearAllSuccess: "All memory cleared",
      factDeleteConfirmTitle: "Delete this fact?",
      factDeleteConfirmDescription:
        "This fact will be removed from memory immediately. This action cannot be undone.",
      factDeleteSuccess: "Fact deleted",
      factContentLabel: "Content",
      factCategoryLabel: "Category",
      factConfidenceLabel: "Confidence",
      factContentPlaceholder: "Describe the memory fact you want to save",
      factCategoryPlaceholder: "context",
      factConfidenceHint: "Use a number between 0 and 1.",
      factSave: "Save fact",
      factValidationContent: "Fact content cannot be empty.",
      factValidationConfidence: "Confidence must be a number between 0 and 1.",
      noFacts: "No saved facts yet.",
      summaryReadOnly:
        "Summary sections are read-only for now. You can currently add, edit, or delete individual facts, or clear all memory.",
      memoryFullyEmpty: "No memory saved yet.",
      factPreviewLabel: "Fact to delete",
      searchPlaceholder: "Search memory",
      filterAll: "All",
      filterFacts: "Facts",
      filterSummaries: "Summaries",
      noMatches: "No matching memory found.",
      markdown: {
        overview: "Overview",
        userContext: "User context",
        work: "Work",
        personal: "Personal",
        topOfMind: "Top of mind",
        historyBackground: "History",
        recentMonths: "Recent months",
        earlierContext: "Earlier context",
        longTermBackground: "Long-term background",
        updatedAt: "Updated at",
        facts: "Facts",
        empty: "(empty)",
        table: {
          category: "Category",
          confidence: "Confidence",
          confidenceLevel: {
            veryHigh: "Very high",
            high: "High",
            normal: "Normal",
            unknown: "Unknown",
          },
          content: "Content",
          source: "Source",
          createdAt: "CreatedAt",
          view: "View",
        },
      },
    },
    appearance: {
      themeTitle: "Theme",
      themeDescription:
        "Choose how the interface follows your device or stays fixed.",
      system: "System",
      light: "Light",
      dark: "Dark",
      systemDescription: "Match the operating system preference automatically.",
      lightDescription: "Bright palette with higher contrast for daytime.",
      darkDescription: "Dim palette that reduces glare for focus.",
      languageTitle: "Language",
      languageDescription: "Switch between languages.",
    },
    tools: {
      title: "Tools",
      description: "Manage the configuration and enabled status of MCP tools.",
    },
    skills: {
      title: "Agent Skills",
      description:
        "Manage the configuration and enabled status of the agent skills.",
      createSkill: "Create skill",
      emptyTitle: "No agent skill yet",
      emptyDescription:
        "Put your agent skill folders under the `/skills/custom` folder under the root folder of KKOCLAW.",
      emptyButton: "Create Your First Skill",
    },
    notification: {
      title: "Notification",
      description:
        "KKOCLAW only sends a completion notification when the window is not active. This is especially useful for long-running tasks so you can switch to other work and get notified when done.",
      requestPermission: "Request notification permission",
      deniedHint:
        "Notification permission was denied. You can enable it in your browser's site settings to receive completion alerts.",
      testButton: "Send test notification",
      testTitle: "KKOCLAW",
      testBody: "This is a test notification.",
      notSupported: "Your browser does not support notifications.",
      disableNotification: "Disable notification",
    },
    tokenUsage: {
      title: "Token Usage Statistics",
      description: "View token usage distribution across different models.",
      summaryTotalTokens: "Total Tokens",
      summaryTotalRuns: "Total Runs",
      summaryModels: "Models Used",
      byModel: "By Model",
      byCaller: "By Caller",
      modelColumn: "Model",
      tokensColumn: "Tokens",
      runsColumn: "Runs",
      leadAgent: "Lead Agent",
      subagent: "Sub-agent",
      middleware: "Middleware",
      noData: "No token usage data",
    },
    acknowledge: {
      emptyTitle: "Acknowledgements",
      emptyDescription: "Credits and acknowledgements will show here.",
    },
  },
};
