import { App, Plugin, PluginSettingTab, Setting, View } from "obsidian";

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
  expandBelow: 5,
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

    // Only react to file-open. layout-change / active-leaf-change fire on
    // every minor UI change (Cmd+Shift+F, sidebar toggle, focus shift), and
    // since expandInPanel re-clicks chevrons N times each run, those would
    // make backlink lines grow unboundedly. New panels appearing dynamically
    // (DNE cards, sidebar pane opened) are handled by the MutationObserver.
    this.registerEvent(
      this.app.workspace.on("file-open", () => this.scheduleApply()),
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
          // Collect every match in or under the added subtree. We need to
          // inspect each one's ancestry: when DNE adds a whole card, the
          // backlink panel and its matches arrive together in the same
          // subtree; when matches stream into an existing panel, only the
          // matches are added. Both must trigger us, but global search
          // results (also .search-result-file-match) must not.
          const matches: HTMLElement[] = [];
          if (node.matches?.(MATCH_SELECTOR)) matches.push(node);
          node
            .querySelectorAll?.<HTMLElement>(MATCH_SELECTOR)
            .forEach((el) => matches.push(el));
          if (matches.length === 0) continue;
          const inPanel = matches.some((mm) =>
            PANEL_SELECTORS.some((sel) => !!mm.closest(sel)),
          );
          if (!inPanel) continue;
          this.scheduleApply();
          return;
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
      if (isExternalInputFocused()) return;
      void this.applyToAllPanels();
    }, this.settings.applyDelayMs);
  }

  private async applyToAllPanels() {
    const myRunId = ++this.runId;
    const panels = this.collectPanels();
    for (const panel of panels) {
      if (myRunId !== this.runId) return;
      if (isExternalInputFocused()) return;
      await this.applyToPanel(panel, myRunId);
    }
  }

  private collectPanels(): HTMLElement[] {
    // Only collect panels inside the active leaf. Clicking expand buttons
    // activates the panel's parent leaf and steals focus, which breaks any
    // input focus elsewhere (global search, quick switcher, command palette,
    // backlink filter, even just typing in another split's editor). Limiting
    // to the active leaf keeps the behavior local — sidebars and other leaves
    // get expanded when the user switches to them (active-leaf-change refires
    // the apply).
    const root = this.app.workspace.getActiveViewOfType(View)?.containerEl;
    if (!root) return [];
    const seen = new Set<HTMLElement>();
    for (const sel of PANEL_SELECTORS) {
      root.querySelectorAll<HTMLElement>(sel).forEach((el) => seen.add(el));
    }
    return Array.from(seen);
  }

  private async applyToPanel(panel: HTMLElement, myRunId: number) {
    if (this.settings.showMoreContext) {
      if (isExternalInputFocused()) return;
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
      if (isExternalInputFocused()) return;
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

// Bail when an input/textarea has focus (e.g. global search via Cmd+Shift+F,
// or the backlinks panel's own filter input). Clicking expand buttons
// activates the parent leaf and would steal focus back to the editor.
// Obsidian's note editor is contenteditable, not <input>, so typing in a note
// doesn't trigger this.
function isExternalInputFocused(): boolean {
  const active = document.activeElement;
  if (!active) return false;
  const tag = active.tagName;
  return tag === "INPUT" || tag === "TEXTAREA";
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
      .setDesc("Always enable show more context in the backlinks panel.")
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
