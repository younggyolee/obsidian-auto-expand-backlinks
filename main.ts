import { App, Plugin, PluginSettingTab, Setting } from "obsidian";

interface AutoExpandBacklinksSettings {
  enabled: boolean;
  showMoreContext: boolean;
  expandBelow: number;
  expandAbove: number;
  applyDelayMs: number;
  perClickDelayMs: number;
}

const DEFAULT_SETTINGS: AutoExpandBacklinksSettings = {
  enabled: true,
  showMoreContext: true,
  expandBelow: 1,
  expandAbove: 0,
  applyDelayMs: 200,
  perClickDelayMs: 20,
};

// CSS selectors for backlink panels in any view (MarkdownView's
// embedded-backlinks, the standalone backlink pane, and Daily Notes Editor's
// per-card backlinks — all share these class names).
const PANEL_SELECTORS = [
  ".embedded-backlinks",
  ".workspace-leaf-content[data-type='backlink']",
];
const MATCH_SELECTOR = ".search-result-file-match";
const DOWN_BTN_SELECTOR = ".search-result-hover-button.mod-bottom";
const UP_BTN_SELECTOR = ".search-result-hover-button.mod-top";
const HEADER_TOGGLE_SELECTOR =
  ".clickable-icon[aria-label='Show more context']";

export default class AutoExpandBacklinksPlugin extends Plugin {
  settings: AutoExpandBacklinksSettings = DEFAULT_SETTINGS;
  private pendingTimeout: number | null = null;
  private runId = 0;
  private mutationObserver: MutationObserver | null = null;

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new AutoExpandBacklinksSettingTab(this.app, this));

    this.registerEvent(
      this.app.workspace.on("file-open", () => this.scheduleApply()),
    );
    this.registerEvent(
      this.app.workspace.on("layout-change", () => this.scheduleApply()),
    );
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => this.scheduleApply()),
    );

    this.app.workspace.onLayoutReady(() => {
      this.installPanelObserver();
      this.scheduleApply();
    });
  }

  onunload() {
    if (this.pendingTimeout !== null) {
      window.clearTimeout(this.pendingTimeout);
      this.pendingTimeout = null;
    }
    this.mutationObserver?.disconnect();
    this.mutationObserver = null;
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  // Watch for new backlink panels appearing (e.g. DNE renders new cards as you
  // scroll). Cheap: just triggers our debounced apply when relevant nodes show.
  private installPanelObserver() {
    if (this.mutationObserver) return;
    this.mutationObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of Array.from(m.addedNodes)) {
          if (!(node instanceof HTMLElement)) continue;
          if (
            node.matches?.(MATCH_SELECTOR) ||
            node.querySelector?.(MATCH_SELECTOR)
          ) {
            this.scheduleApply();
            return;
          }
        }
      }
    });
    // Scope to the workspace container so we don't fire on unrelated DOM
    // mutations (modals, tooltips, settings, etc.).
    const root =
      (this.app.workspace as unknown as { containerEl?: HTMLElement })
        .containerEl ?? document.body;
    this.mutationObserver.observe(root, {
      childList: true,
      subtree: true,
    });
  }

  scheduleApply() {
    if (!this.settings.enabled) return;
    if (this.pendingTimeout !== null) {
      window.clearTimeout(this.pendingTimeout);
    }
    this.pendingTimeout = window.setTimeout(() => {
      this.pendingTimeout = null;
      void this.applyToAllPanels();
    }, this.settings.applyDelayMs);
  }

  private async applyToAllPanels() {
    const myRunId = ++this.runId;
    const panels = this.collectPanels();
    for (const panel of panels) {
      if (myRunId !== this.runId) return;
      await this.applyToPanel(panel, myRunId);
    }
  }

  private collectPanels(): HTMLElement[] {
    const seen = new Set<HTMLElement>();
    for (const sel of PANEL_SELECTORS) {
      document
        .querySelectorAll<HTMLElement>(sel)
        .forEach((el) => seen.add(el));
    }
    return Array.from(seen);
  }

  private async applyToPanel(panel: HTMLElement, myRunId: number) {
    if (this.settings.showMoreContext) {
      const toggle = panel.querySelector<HTMLElement>(HEADER_TOGGLE_SELECTOR);
      if (toggle && !toggle.classList.contains("is-active")) {
        toggle.click();
        await sleep(this.settings.applyDelayMs);
        if (myRunId !== this.runId) return;
      }
    }

    await this.expandInPanel(
      panel,
      this.settings.expandBelow,
      DOWN_BTN_SELECTOR,
      myRunId,
    );
    await this.expandInPanel(
      panel,
      this.settings.expandAbove,
      UP_BTN_SELECTOR,
      myRunId,
    );
  }

  private async expandInPanel(
    panel: HTMLElement,
    levels: number,
    btnSelector: string,
    myRunId: number,
  ) {
    for (let i = 0; i < levels; i++) {
      if (myRunId !== this.runId) return;
      const buttons = Array.from(
        panel.querySelectorAll<HTMLElement>(`${MATCH_SELECTOR} ${btnSelector}`),
      );
      if (buttons.length === 0) return;
      for (const btn of buttons) btn.click();
      await sleep(this.settings.perClickDelayMs);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => window.setTimeout(r, ms));
}

class AutoExpandBacklinksSettingTab extends PluginSettingTab {
  plugin: AutoExpandBacklinksPlugin;

  constructor(app: App, plugin: AutoExpandBacklinksPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Enabled")
      .setDesc("Auto-expand backlink context whenever a note is opened.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.enabled).onChange(async (v) => {
          this.plugin.settings.enabled = v;
          await this.plugin.saveSettings();
          if (v) this.plugin.scheduleApply();
        }),
      );

    new Setting(containerEl)
      .setName("Show more context")
      .setDesc("Force the backlinks panel's 'Show more context' toggle on.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showMoreContext)
          .onChange(async (v) => {
            this.plugin.settings.showMoreContext = v;
            await this.plugin.saveSettings();
            this.plugin.scheduleApply();
          }),
      );

    new Setting(containerEl)
      .setName("Expand below (levels)")
      .setDesc(
        "Number of times to click each match's 'show more below' chevron. " +
          "Each click reveals one more line of context.",
      )
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.expandBelow))
          .onChange(async (raw) => {
            const n = Math.max(0, Math.floor(Number(raw)));
            if (Number.isNaN(n)) return;
            this.plugin.settings.expandBelow = n;
            await this.plugin.saveSettings();
            this.plugin.scheduleApply();
          }),
      );

    new Setting(containerEl)
      .setName("Expand above (levels)")
      .setDesc(
        "Number of times to click each match's 'show more above' chevron.",
      )
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.expandAbove))
          .onChange(async (raw) => {
            const n = Math.max(0, Math.floor(Number(raw)));
            if (Number.isNaN(n)) return;
            this.plugin.settings.expandAbove = n;
            await this.plugin.saveSettings();
            this.plugin.scheduleApply();
          }),
      );

    new Setting(containerEl)
      .setName("Apply delay (ms)")
      .setDesc("Wait after a file opens / panel appears before expanding.")
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.applyDelayMs))
          .onChange(async (raw) => {
            const n = Math.max(0, Math.floor(Number(raw)));
            if (Number.isNaN(n)) return;
            this.plugin.settings.applyDelayMs = n;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Per-click delay (ms)")
      .setDesc("Pause between successive expand-button clicks.")
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.perClickDelayMs))
          .onChange(async (raw) => {
            const n = Math.max(0, Math.floor(Number(raw)));
            if (Number.isNaN(n)) return;
            this.plugin.settings.perClickDelayMs = n;
            await this.plugin.saveSettings();
          }),
      );
  }
}
