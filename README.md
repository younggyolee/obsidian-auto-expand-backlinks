# Auto-Expand Backlinks

An Obsidian plugin that automatically expands the context shown in the bottom **backlinks panel** (and the standalone backlinks pane) so you don't have to click the chevrons on every match.

Inspired by this forum request: <https://forum.obsidian.md/t/backlink-to-display-more-context-by-default/102810>

## What it does

When you open a note, this plugin:

1. Forces the backlinks panel's **"Show more context"** toggle on.
2. Programmatically clicks each match's **"show more above"** / **"show more below"** chevrons a configurable number of times — revealing the surrounding lines (or sub-bullets) without manual clicks.

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| Enabled | on | Master toggle. |
| Show more context | on | Forces the panel's "Show more context" header toggle on by default. |
| Expand below (levels) | `1` | How many times to click each match's "show more below" chevron. `1` matches the forum example. |
| Expand above (levels) | `0` | How many times to click each match's "show more above" chevron. |
| Apply delay (ms) | `200` | Wait between file open and applying expansion. Increase for slow vaults. |
| Per-click delay (ms) | `20` | Pause between successive expand clicks. |

## Install via BRAT (recommended for now)

1. Install the [BRAT plugin](https://github.com/TfTHacker/obsidian42-brat).
2. Open BRAT settings → **Add Beta plugin**.
3. Enter this repo URL.
4. Enable **Auto-Expand Backlinks** in Community plugins.

## Install manually

Download `main.js`, `manifest.json`, `styles.css` from the latest [release](../../releases/latest) into `<vault>/.obsidian/plugins/auto-expand-backlinks/`, then enable in Settings → Community plugins.

## How it works

Obsidian's backlinks panel doesn't expose a documented API for default expansion. This plugin reaches into the internal `view.backlinks.backlinkDom` to flip `extraContext`, then clicks the per-match `.search-result-hover-button.mod-bottom` / `.mod-top` DOM buttons that Obsidian uses for context expansion.

Because it relies on internal/undocumented APIs, it may break on future Obsidian releases.

## Known limitations

- Only the bottom **backlinks panel** and the **standalone backlinks pane** are touched. The left-sidebar **search** panel is not (intentionally — different use case).
- Each "level" of expansion = one click of the chevron = one more line of context in Obsidian's source file.

## License

MIT — see [LICENSE](./LICENSE).
