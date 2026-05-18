# Release process

Submissions and updates now go through the **Obsidian Community Portal** (https://obsidian.md/blog/future-of-plugins/), not the old `obsidian-releases` PR workflow. The portal still pulls plugin code from GitHub, so the release-asset requirement below is unchanged.

Obsidian scans for a **GitHub Release** (not just a tag) matching `manifest.json`'s version exactly, with `main.js`, `manifest.json`, and `styles.css` attached as assets. A tag alone will fail with "No release matches your manifest version".

Use **bare semver** (`0.2.7`), never `v0.2.7` — Obsidian requires no `v` prefix.

Full flow for a new version:

1. Bump version in `manifest.json`, `package.json`, and `versions.json` (add a new `"<version>": "<minAppVersion>"` entry).
2. Commit.
3. Tag and push: `git tag <version> && git push && git push --tags`.
4. Build: `npm run build` (regenerates `main.js` — easy to forget).
5. Create the GitHub release with assets:
   ```
   gh release create <version> main.js manifest.json styles.css \
     --title <version> \
     --notes "..."
   ```

Skipping step 4 or 5 is the usual failure mode.
