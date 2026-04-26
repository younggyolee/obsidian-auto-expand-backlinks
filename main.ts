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
  expandBelow: 1,
  expandAbove: 0,
  applyDelayMs: 200,
  perClickDelayMs: 20,
};

interface SearchResultDomLike {
  extraContext?: boolean;
  setExtraContext?: (value: boolean) => void;
  changed?: () => void;
  containerEl?: HTMLElement;
  el?: HTMLElement;
}

interface BacklinkComponentLike {
  backlinkDom?: SearchResultDomLike;
  unlinkedDom?: SearchResultDomLike;
}

interface ViewWithBacklinks extends View {
  backlinks?: BacklinkComponentLike;
}

const MATCH_SELECTOR = ".search-result-file-match";
const DOWN_BTN_SELECTOR = ".search-result-hover-button.mod-bottom";
const UP_BTN_SELECTOR = ".search-result-hover-button.mod-top";

export default class AutoExpandBacklinksPlugin extends Plugin {
  settings: AutoExpandBacklinksSettings = DEFAULT_SETTINGS;
  private pendingTimeout: number | null = null;
  private runId = 0;

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

    // Apply on initial load too.
    this.app.workspace.onLayoutReady(() => this.scheduleApply());
  }

  onunload() {
    if (this.pendingTimeout !== null) {
      window.clearTimeout(this.pendingTimeout);
      this.pendingTimeout = null;
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  scheduleApply() {
    if (!this.settings.enabled) return;
    if (this.pendingTimeout !== null) {
      window.clearTimeout(this.pendingTimeout);
    }
    this.pendingTimeout = window.setTimeout(() => {
      this.pendingTimeout = null;
      void this.applyToAllBacklinkPanels();
    }, this.settings.applyDelayMs);
  }

  private async applyToAllBacklinkPanels() {
    const myRunId = ++this.runId;
    for (const dom of this.collectBacklinkDoms()) {
      if (myRunId !== this.runId) return; // newer run superseded us
      await this.applyToDom(dom, myRunId);
    }
  }

  private collectBacklinkDoms(): SearchResultDomLike[] {
    const doms: SearchResultDomLike[] = [];

    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view as ViewWithBacklinks;
      const backlinks = view.backlinks;
      if (backlinks?.backlinkDom) doms.push(backlinks.backlinkDom);
      if (backlinks?.unlinkedDom) doms.push(backlinks.unlinkedDom);
    }
    for (const leaf of this.app.workspace.getLeavesOfType("backlink")) {
      const backlinks = leaf.view as unknown as BacklinkComponentLike;
      if (backlinks?.backlinkDom) doms.push(backlinks.backlinkDom);
      if (backlinks?.unlinkedDom) doms.push(backlinks.unlinkedDom);
    }
    return doms;
  }

  private async applyToDom(dom: SearchResultDomLike, myRunId: number) {
    if (this.settings.showMoreContext && dom.extraContext !== true) {
      if (typeof dom.setExtraContext === "function") {
        dom.setExtraContext(true);
      } else {
        dom.extraContext = true;
      }
      if (typeof dom.changed === "function") dom.changed();
      // Wait for re-render before clicking expand buttons.
      await sleep(this.settings.applyDelayMs);
      if (myRunId !== this.runId) return;
    }

    const root = dom.containerEl ?? dom.el ?? null;
    if (!root) return;

    await this.expandInRoot(
      root,
      this.settings.expandBelow,
      DOWN_BTN_SELECTOR,
      myRunId,
    );
    await this.expandInRoot(
      root,
      this.settings.expandAbove,
      UP_BTN_SELECTOR,
      myRunId,
    );
  }

  private async expandInRoot(
    root: HTMLElement,
    levels: number,
    btnSelector: string,
    myRunId: number,
  ) {
    for (let i = 0; i < levels; i++) {
      if (myRunId !== this.runId) return;
      const buttons = Array.from(
        root.querySelectorAll<HTMLElement>(`${MATCH_SELECTOR} ${btnSelector}`),
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
          "1 = the forum example. Each click reveals one more line of context.",
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
      .setDesc(
        "Wait after a file opens before expanding. Increase if matches " +
          "sometimes don't expand on slow vaults.",
      )
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
      .setDesc(
        "Pause between successive expand-button clicks. Lower = faster but " +
          "may skip levels on slow vaults.",
      )
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
