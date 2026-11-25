/**
 * Styles for every surface this plugin draws.
 *
 * Colours come from the host theme's alias tokens so the panel inherits light
 * and dark themes without a second palette; the only literal colours are the
 * language tints the file icons carry, which are artwork.
 */

const IDE_CSS = `
.iw-root {
  /* The panel is the positioning container for its own overlays: a fixed popup
     would keep covering the conversation composer after the panel is hidden. */
  position: relative;
  isolation: isolate;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  box-sizing: border-box;
  /* Shipped entry pages clear the macOS window strip (traffic lights) with this
     documented variable; the conversation owns its own header instead. */
  padding-top: var(--dsh-frame-top-clearance, 0px);
  background: var(--dsw-alias-bg-base, #1b1d21);
  color: var(--dsw-alias-label-primary, #e6e8ec);
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  font-size: 12.5px;
  overflow: hidden;
}
.iw-toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 40px;
  padding: 0 8px;
  flex: 0 0 auto;
  border-bottom: 1px solid var(--dsw-alias-border-l1, #2c3038);
  background: var(--dsw-specific-sidebar-fill, var(--dsw-alias-bg-layer-1, #212429));
}
.iw-project {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding: 0 4px 0 2px;
  font-weight: 600;
  font-size: 13.5px;
  letter-spacing: 0.01em;
}
.iw-project-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 240px;
}
.iw-project-path {
  color: var(--dsw-alias-label-secondary, #98a0ad);
  font-weight: 400;
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 320px;
  direction: rtl;
  text-align: left;
}
.iw-spacer { flex: 1 1 auto; min-width: 6px; }
.iw-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  height: 26px;
  min-width: 26px;
  padding: 0 7px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #98a0ad);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  transition: background 90ms ease, color 90ms ease, border-color 90ms ease;
}
.iw-btn:hover {
  background: var(--dsw-alias-bg-layer-2, #2a2e35);
  color: var(--dsw-alias-label-primary, #e6e8ec);
}
.iw-btn:active { background: var(--dsw-alias-bg-layer-1, #212429); }
.iw-btn.on {
  color: var(--dsw-alias-brand-primary, #5b9dff);
  background: color-mix(in srgb, var(--dsw-alias-brand-primary, #5b9dff) 14%, transparent);
}
.iw-btn.primary {
  color: var(--dsw-alias-label-primary, #e6e8ec);
  border-color: var(--dsw-alias-border-l1, #2c3038);
}
.iw-btn:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary, #5b9dff);
  outline-offset: 1px;
}
.iw-body {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}
.iw-tree {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 0 0 auto;
  border-right: 1px solid var(--dsw-alias-border-l1, #2c3038);
  background: var(--dsw-specific-sidebar-fill, var(--dsw-alias-bg-layer-1, #212429));
}
.iw-search {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 8px 8px 6px;
  padding: 0 8px;
  height: 31px;
  border: 1px solid var(--dsw-alias-border-l1, #2c3038);
  border-radius: 6px;
  background: var(--dsw-alias-bg-base, #1b1d21);
}
.iw-search input {
  flex: 1 1 auto;
  min-width: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 14px;
  outline: none;
}
.iw-search input::placeholder { color: var(--dsw-alias-label-secondary, #98a0ad); opacity: 0.75; }

/* One workspace-search result: name first, its directory dimmed beside it. */
.iw-result {
  display: flex;
  align-items: baseline;
  gap: 8px;
  width: 100%;
  padding: 4px 10px 4px 12px;
  border: 0;
  background: transparent;
  color: var(--dsw-alias-label-primary, #e6e8ec);
  font: inherit;
  text-align: left;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
}
.iw-result:hover, .iw-result:focus-visible { background: var(--dsw-alias-bg-layer-2, #2a2e35); }
.iw-result-name { flex: 0 1 auto; overflow: hidden; text-overflow: ellipsis; }
.iw-result-dir {
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--dsw-alias-label-secondary, #98a0ad);
  font-size: 12px;
}
.iw-tree-scroll {
  flex: 1 1 auto;
  overflow: auto;
  padding: 2px 0 10px;
}
.iw-tree-tools {
  display: flex;
  justify-content: flex-end;
  gap: 2px;
  padding: 4px 8px 0;
}
.iw-tree-tool {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #98a0ad);
  cursor: pointer;
}
.iw-tree-tool:hover {
  background: var(--dsw-alias-bg-layer-2, #2a2e35);
  color: var(--dsw-alias-label-primary, #e6e8ec);
}
.iw-row.flash { animation: iw-flash 1.2s ease-out; }
@keyframes iw-flash {
  from { background: color-mix(in srgb, var(--dsw-alias-brand-primary, #5b9dff) 35%, transparent); }
  to { background: transparent; }
}
.iw-row {
  display: flex;
  align-items: center;
  gap: 5px;
  height: var(--iw-row-height, 27px);
  font-size: var(--iw-tree-font-size, 14.5px);
  padding-right: 8px;
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
  color: var(--dsw-alias-label-primary, #e6e8ec);
}
.iw-row:hover { background: var(--dsw-alias-bg-layer-2, #2a2e35); }
.iw-row.active {
  background: color-mix(in srgb, var(--dsw-alias-brand-primary, #5b9dff) 18%, transparent);
}
.iw-row.dim { color: var(--dsw-alias-label-secondary, #98a0ad); }
.iw-row .iw-twisty {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
  color: var(--dsw-alias-label-secondary, #98a0ad);
}
/* Git status on the tree: a changed file reads blue-green, a new one brown-red.
   These are semantic editor colours, not theme surfaces. */
.iw-row .iw-name.vcs-modified { color: #2fa79a; }
.iw-row .iw-name.vcs-added { color: #b35f3d; }

.iw-row .iw-icon { display: inline-flex; flex: 0 0 auto; }
.iw-row .iw-name {
  overflow: hidden;
  text-overflow: ellipsis;
}
.iw-row .iw-note {
  margin-left: auto;
  padding-left: 8px;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary, #98a0ad);
  opacity: 0.8;
}
.iw-hint {
  padding: 10px 12px;
  color: var(--dsw-alias-label-secondary, #98a0ad);
  font-size: 13px;
  line-height: 1.5;
}
.iw-hint.error { color: var(--dsw-alias-state-error-primary, #e5646a); }
.iw-resizer {
  flex: 0 0 4px;
  cursor: col-resize;
  background: transparent;
}
.iw-resizer:hover { background: var(--dsw-alias-brand-primary, #5b9dff); opacity: 0.5; }
.iw-editor {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  background: var(--dsw-alias-bg-base, #1b1d21);
}
.iw-tabs {
  display: flex;
  align-items: stretch;
  height: 35px;
  flex: 0 0 auto;
  overflow-x: auto;
  overflow-y: hidden;
  border-bottom: 1px solid var(--dsw-alias-border-l1, #2c3038);
  background: var(--dsw-specific-sidebar-fill, var(--dsw-alias-bg-layer-1, #212429));
  scrollbar-width: none;
}
.iw-tabs::-webkit-scrollbar { height: 0; }
.iw-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px 0 10px;
  max-width: 230px;
  border-right: 1px solid var(--dsw-alias-border-l1, #2c3038);
  background: transparent;
  color: var(--dsw-alias-label-secondary, #98a0ad);
  cursor: pointer;
  user-select: none;
  position: relative;
  flex: 0 0 auto;
}
.iw-tab:hover { background: var(--dsw-alias-bg-layer-2, #2a2e35); }
.iw-tab.active {
  background: var(--dsw-alias-bg-base, #1b1d21);
  color: var(--dsw-alias-label-primary, #e6e8ec);
}
.iw-tab.active::after {
  content: "";
  position: absolute;
  left: 0; right: 0; top: 0;
  height: 2px;
  background: var(--dsw-alias-brand-primary, #5b9dff);
}
.iw-tab .iw-tab-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13.5px;
}
.iw-tab .iw-tab-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  opacity: 0.72;
  flex: 0 0 auto;
}
.iw-tab .iw-tab-close:hover { opacity: 1; background: var(--dsw-alias-bg-layer-2, #2a2e35); }
.iw-tab.chat { max-width: none; padding-right: 10px; }
.iw-crumbs {
  display: flex;
  align-items: center;
  gap: 2px;
  height: 28px;
  padding: 0 10px;
  flex: 0 0 auto;
  border-bottom: 1px solid var(--dsw-alias-border-l1, #2c3038);
  font-size: 13px;
  color: var(--dsw-alias-label-secondary, #98a0ad);
  overflow: hidden;
  white-space: nowrap;
}
.iw-crumbs .iw-crumb-file { color: var(--dsw-alias-label-primary, #e6e8ec); }
.iw-crumbs .iw-crumb-dirs {
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.iw-code {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
  font-size: var(--iw-code-font-size, 12.5px);
  line-height: var(--iw-code-line-height, 20px);
  tab-size: 4;
}
.iw-code-inner { min-width: 100%; }
.iw-line {
  display: flex;
  align-items: flex-start;
  height: 20px;
  min-width: 100%;
  white-space: pre;
}
.iw-line:hover { background: color-mix(in srgb, var(--dsw-alias-label-primary, #e6e8ec) 5%, transparent); }
.iw-line.hit {
  background: color-mix(in srgb, var(--dsw-alias-brand-primary, #5b9dff) 20%, transparent);
  box-shadow: inset 2px 0 0 var(--dsw-alias-brand-primary, #5b9dff);
}
/* The VCS change bar, left of the line number: added, modified, deleted. */
.iw-vcs {
  flex: 0 0 auto;
  width: 3px;
  align-self: stretch;
  background: transparent;
}
.iw-vcs.a { background: #3fa55a; }
.iw-vcs.m { background: #3b7dd8; }
.iw-vcs.d { background: #c95c5c; }
.iw-blame {
  flex: 0 0 auto;
  width: 168px;
  padding-right: 10px;
  text-align: right;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-secondary, #98a0ad);
  font-size: 11px;
  opacity: 0.85;
  user-select: none;
  border-right: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.08));
}
.iw-blame.b { background: color-mix(in srgb, var(--dsw-alias-label-primary, #e6e8ec) 4%, transparent); }
.iw-ln {
  flex: 0 0 auto;
  width: 56px;
  padding-right: 12px;
  text-align: right;
  color: var(--dsw-alias-label-secondary, #98a0ad);
  opacity: 0.55;
  user-select: none;
}
.iw-src { flex: 0 0 auto; padding-right: 24px; }
/* Code Vision: usage/implementation counts and the last commit, after the line. */
.iw-vision {
  flex: 0 0 auto;
  margin-left: 18px;
  color: var(--dsw-alias-label-tertiary, #7c8592);
  opacity: 0.8;
  user-select: none;
  font-style: italic;
}
/* Syntax colours are their own layer: a palette sets --iw-syn-* because a
   keyword colour that reads on #282a36 is unreadable on #ffffff. The literals
   are the DSH-palette defaults for "follow DSH". */
.iw-kw { color: var(--iw-syn-keyword, #cf8ee6); }
.iw-str { color: var(--iw-syn-string, #9ddc8b); }
.iw-num { color: var(--iw-syn-number, #e0b072); }
.iw-com { color: var(--iw-syn-comment, #6d7683); font-style: italic; }
.iw-ann { color: var(--iw-syn-annotation, #e0c56b); }
.iw-type { color: var(--iw-syn-type, #7fc8f0); }
.iw-fn { color: var(--iw-syn-function, #8fd7d0); }
.iw-punct { color: var(--iw-syn-punct, var(--dsw-alias-label-secondary, #98a0ad)); }
.iw-sym { cursor: pointer; border-radius: 3px; }
.iw-sym:hover {
  background: color-mix(in srgb, var(--dsw-alias-brand-primary, #5b9dff) 22%, transparent);
}
.iw-pop {
  position: fixed;
  z-index: 60;
  width: 500px;
  max-height: 340px;
  display: flex;
  flex-direction: column;
  background: var(--dsw-alias-bg-overlay, #23262b);
  border: 1px solid var(--dsw-alias-border-l2, #3a3f48);
  border-radius: 10px;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.45);
  overflow: hidden;
  font-size: 12.5px;
}
.iw-pop-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 10px;
  border-bottom: 1px solid var(--dsw-alias-border-l1, #2c3038);
  background: var(--dsw-specific-sidebar-fill, var(--dsw-alias-bg-layer-1, #212429));
}
.iw-pop-name { font-weight: 600; font-family: ui-monospace, monospace; }
.iw-pop-count { color: var(--dsw-alias-label-secondary, #98a0ad); font-size: 11.5px; }
.iw-pop-body { overflow: auto; padding: 4px; }
.iw-pop-section + .iw-pop-section { margin-top: 4px; }

/* While a file is open, the rest of the page is not selectable: Cmd+A then
   selects the file (gutter columns included), and a drag cannot escape the
   editor. Form fields keep their own text selection. */
html.iw-select-code,
html.iw-select-code body * {
  -webkit-user-select: none;
  user-select: none;
}
html.iw-select-code .iw-code,
html.iw-select-code .iw-code *,
/* The floating card is a reading surface too: without this, the code view's
   global "no selection" class made its transcript unselectable. */
html.iw-select-code .iw-float,
html.iw-select-code .iw-float *,
html.iw-select-code .iw-md,
html.iw-select-code .iw-md *,
html.iw-select-code input,
html.iw-select-code textarea,
html.iw-select-code [contenteditable="true"] {
  -webkit-user-select: text;
  user-select: text;
}
html.iw-select-code .iw-code .iw-vcs,
html.iw-select-code .iw-code .iw-ln,
html.iw-select-code .iw-code .iw-blame,
html.iw-select-code .iw-code .iw-vision {
  -webkit-user-select: none;
  user-select: none;
}

/* The call chain: method cards joined by rounded elbows, mind-map style. */
.iw-pop:focus { outline: none; }
.iw-pop-chain { width: 600px; max-width: 94vw; }
.iw-pop-chain .iw-pop-body { max-height: min(62vh, 540px); overflow-x: hidden; }

.iw-settings-maven {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 6px 0;
  border-top: 0.5px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.06));
}
.iw-settings-maven-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.iw-settings-hint {
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--dsw-alias-label-secondary, #8b93a1);
  word-break: break-all;
}
.iw-settings-hint-path {
  color: var(--dsw-alias-label-primary, #e6e8ec);
  font-variant-numeric: tabular-nums;
}
.iw-settings-hint.warn {
  color: #d9a441;
}
.iw-settings-hint.warn .iw-settings-hint-path {
  color: #d9a441;
}

.iw-settings-input {
  flex: 1;
  min-width: 0;
  max-width: 320px;
  padding: 4px 8px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.14));
  border-radius: var(--dsw-radius-md, 6px);
  background: var(--dsw-alias-bg-layer-2, rgba(255, 255, 255, 0.05));
  color: var(--dsw-alias-label-primary, #e6e8ec);
  font: inherit;
  font-size: 12.5px;
}
.iw-settings-input::placeholder {
  color: var(--dsw-alias-label-secondary, #8b93a1);
}
.iw-settings-input:focus {
  outline: none;
  border-color: var(--dsw-alias-border-l3, rgba(255, 255, 255, 0.28));
}

.iw-chain-roots {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.iw-chain-rule {
  padding: 2px 8px 6px;
  color: var(--dsw-alias-label-tertiary, #6f7783);
  font-size: 11px;
}

/* Shown when the chain was built from text matches instead of the engine. */
.iw-chain-note {
  padding: 0 8px 6px;
  color: var(--dsw-alias-label-tertiary, #6f7783);
  font-size: 11px;
  opacity: 0.9;
}
.iw-chain-node { position: relative; }
.iw-chain-node + .iw-chain-node { margin-top: 2px; }
.iw-chain-children {
  position: relative;
  margin-left: 8px;
  padding-left: 16px;
  border-left: 1.5px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.14));
}
.iw-chain-children > .iw-chain-node::before {
  content: '';
  position: absolute;
  left: -16px;
  top: 0;
  width: 16px;
  height: 14px;
  border-left: 1.5px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.14));
  border-bottom: 1.5px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.14));
  border-bottom-left-radius: 9px;
  pointer-events: none;
}

.iw-chain-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: fit-content;
  max-width: 100%;
  overflow: hidden;
  padding: 5px 11px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-2, rgba(255, 255, 255, 0.05));
  color: var(--dsw-alias-label-primary, #e6e8ec);
  font: inherit;
  font-size: 12.5px;
  text-align: left;
  cursor: pointer;
}
.iw-chain-row:hover {
  border-color: var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.2));
  background: var(--dsw-alias-bg-layer-3, rgba(255, 255, 255, 0.09));
}
.iw-chain-row.root {
  border-color: rgba(122, 162, 255, 0.55);
  background: rgba(122, 162, 255, 0.14);
  font-weight: 600;
}
.iw-chain-dot {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--dsw-alias-label-secondary, #8b93a1);
}
.iw-chain-row.root .iw-chain-dot { background: #7aa2ff; }
.iw-chain-name {
  flex: 0 1 auto;
  min-width: 0;
  font-family: ui-monospace, monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.iw-chain-where {
  flex: 0 1 auto;
  min-width: 0;
  color: var(--dsw-alias-label-secondary, #8b93a1);
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.iw-chain-site {
  flex: none;
  margin-left: 2px;
  color: var(--dsw-alias-label-tertiary, #6f7783);
  font-size: 11px;
  white-space: nowrap;
}
.iw-pop-section-head {
  position: sticky;
  top: -4px;
  padding: 4px 8px 3px;
  background: var(--dsw-alias-bg-overlay, #23262b);
  color: var(--dsw-alias-label-secondary, #98a0ad);
  font-size: 11px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.iw-usage {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 5px 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.iw-usage:hover { background: var(--dsw-alias-bg-layer-2, #2a2e35); }
.iw-usage.def { color: var(--dsw-alias-brand-primary, #5b9dff); }
.iw-usage-file {
  flex: 0 0 auto;
  min-width: 190px;
  color: var(--dsw-alias-label-secondary, #98a0ad);
  font-family: ui-monospace, monospace;
  font-size: 11.5px;
}
.iw-usage.def .iw-usage-file { color: inherit; }
.iw-usage-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: ui-monospace, monospace;
  font-size: 11.5px;
  opacity: 0.9;
}
.iw-status {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 26px;
  padding: 0 10px;
  flex: 0 0 auto;
  border-top: 1px solid var(--dsw-alias-border-l1, #2c3038);
  background: var(--dsw-specific-sidebar-fill, var(--dsw-alias-bg-layer-1, #212429));
  color: var(--dsw-alias-label-secondary, #98a0ad);
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
}
.iw-status .iw-grow { flex: 1 1 auto; }
.iw-live {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--dsw-alias-state-idle-primary, #6b7480);
  flex: 0 0 auto;
}
.iw-live.on {
  background: var(--dsw-alias-state-success-primary, #4fb477);
  box-shadow: 0 0 0 0 color-mix(in srgb, var(--dsw-alias-state-success-primary, #4fb477) 60%, transparent);
  animation: iw-pulse 2.4s ease-out infinite;
}
@keyframes iw-pulse {
  0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--dsw-alias-state-success-primary, #4fb477) 55%, transparent); }
  70% { box-shadow: 0 0 0 5px transparent; }
  100% { box-shadow: 0 0 0 0 transparent; }
}
.iw-empty {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: var(--dsw-alias-label-secondary, #98a0ad);
  font-size: 13.5px;
  padding: 24px;
  text-align: center;
}
.iw-empty .iw-empty-title { color: var(--dsw-alias-label-primary, #e6e8ec); font-size: 15px; font-weight: 600; }
.iw-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  font-size: 13px;
  color: var(--dsw-alias-state-warn-primary, #d8a24a);
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #d8a24a) 10%, transparent);
  border-bottom: 1px solid var(--dsw-alias-border-l1, #2c3038);
}
.iw-sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

/* ---- Search Everywhere -------------------------------------------------- */
.iw-palette-backdrop {
  position: absolute;
  inset: 0;
  z-index: 60;
  /* DSH's popovers ride on their own surface, so the backdrop stays clear. */
  background: transparent;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 12vh;
}
.iw-palette {
  width: min(760px, 88vw);
  max-height: 62vh;
  display: flex;
  flex-direction: column;
  /* Same surface, stroke and elevation tokens as DSH's own menus. */
  background: var(--dsw-specific-menu, var(--dsw-alias-bg-layer-2, #23262b));
  backdrop-filter: var(--dsw-menu-backdrop-filter, none);
  border: 0.5px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.08));
  border-radius: var(--dsw-radius-lg, 12px);
  box-shadow: var(--dsw-elevation-prominent, 0 18px 48px rgba(0, 0, 0, 0.45));
  color: var(--dsw-alias-label-primary, inherit);
  overflow: hidden;
}
.iw-palette-input {
  border: 0;
  outline: none;
  padding: 9px 12px;
  font-family: var(--dsw-font-family, inherit);
  font-size: 13px;
  background: transparent;
  color: var(--dsw-alias-label-primary, inherit);
  border-bottom: 0.5px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.08));
}
.iw-palette-input::placeholder { color: var(--dsw-alias-label-tertiary, inherit); }
.iw-palette-tabs {
  display: flex;
  gap: 2px;
  padding: 4px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.08));
}
.iw-palette-tab {
  border: 0;
  background: transparent;
  color: var(--dsw-alias-label-secondary, inherit);
  font: inherit;
  font-size: 12px;
  padding: 4px 8px;
  border-radius: var(--dsw-radius-md, 8px);
  cursor: pointer;
}
.iw-palette-tab:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.06)); }
.iw-palette-tab.active {
  background: var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.08));
  color: var(--dsw-alias-label-primary, inherit);
}
.iw-palette-list { flex: 1 1 auto; overflow: auto; padding: 4px; }
.iw-palette-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  width: 100%;
  padding: 5px 7px;
  border: 0;
  border-radius: var(--dsw-radius-md, 8px);
  background: transparent;
  color: var(--dsw-alias-label-primary, inherit);
  font: inherit;
  font-size: 13px;
  line-height: 1.35;
  text-align: left;
  cursor: pointer;
}
.iw-palette-row.active { background: var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.08)); }
.iw-palette-kind {
  flex: 0 0 auto;
  font-size: 10px;
  line-height: 14px;
  padding: 1px 5px;
  border-radius: var(--dsw-radius-sm, 6px);
  background: var(--dsw-alias-bg-layer-2, rgba(255, 255, 255, 0.06));
  color: var(--dsw-alias-label-tertiary, inherit);
}
.iw-palette-label { flex: 0 0 auto; }
.iw-palette-detail {
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-tertiary, inherit);
  font-size: 11.5px;
}
.iw-palette-hint {
  padding: 6px 10px;
  border-top: 0.5px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.08));
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary, inherit);
}

.iw-project-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  padding: 2px 6px;
  border-radius: 6px;
  cursor: pointer;
}
.iw-project-btn:hover { background: var(--dsw-alias-bg-layer-2, #2a2e35); }
.iw-project-caret { font-size: 9px; opacity: 0.7; }
.iw-project-menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 40;
  min-width: 320px;
  max-height: 46vh;
  overflow: auto;
  padding: 4px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border, #34383f);
  background: var(--dsw-alias-bg-overlay, #23262b);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.4);
}
.iw-project-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  width: 100%;
  padding: 5px 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-primary, #e6e8ec);
  font: inherit;
  text-align: left;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
}
.iw-project-row:hover { background: var(--dsw-alias-bg-layer-2, #2a2e35); }
.iw-project-row.active { background: var(--dsw-alias-bg-layer-2, #2a2e35); }
.iw-project-row-title { flex: 0 0 auto; }
.iw-project-row-path {
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 11px;
  color: var(--dsw-alias-label-secondary, #98a0ad);
}

.iw-history { display: inline-flex; align-items: center; gap: 2px; margin-left: 4px; }

/* Entry in the conversation header, left of the Session title. */
.iw-header-entry {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  padding: 0 8px;
  margin-right: 6px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #98a0ad);
  font: inherit;
  font-size: 12.5px;
  cursor: pointer;
  white-space: nowrap;
}
.iw-header-entry:hover {
  background: var(--dsw-alias-bg-layer-2, #2a2e35);
  color: var(--dsw-alias-label-primary, #e6e8ec);
  border-color: var(--dsw-alias-border-l1, #2c3038);
}
.iw-header-entry.active { color: var(--dsw-alias-label-primary, #e6e8ec); }


/* The Turn's changed files — mirroring the shipped deliverables card. */
.iw-turn {
  --iw-changes-fill: var(--dsw-alias-card-fill, transparent);
  --iw-changes-hover: var(--dsw-alias-card-fill-hover, rgba(255, 255, 255, 0.04));
  display: flex;
  flex-direction: column;
  min-width: 0;
  margin-top: 4px;
  overflow: hidden;
  border: 0.5px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.08));
  border-radius: var(--dsw-radius-lg, 10px);
  background: var(--dsw-alias-bg-layer-1, transparent);
  color: var(--dsw-alias-label-primary, inherit);
  max-width: 720px;
}
.iw-turn-head {
  display: flex;
  align-items: center;
  gap: 10px;
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  margin: 0;
  padding: 8px 10px;
  border: 0;
  background: var(--iw-changes-fill);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background-color 120ms ease;
}
.iw-turn-head:hover { background: var(--iw-changes-hover); }
.iw-turn-head:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary, #4a7dff));
}
.iw-turn-tile {
  display: grid;
  flex: none;
  place-items: center;
  box-sizing: border-box;
  width: 40px;
  height: 40px;
  border: 0.5px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.06));
  border-radius: 10px;
  background: var(--dsw-alias-card-tile-fill, transparent);
  color: var(--dsw-alias-label-secondary, inherit);
}
.iw-turn-titles { display: flex; flex: 1; flex-direction: column; min-width: 0; }
.iw-turn-title {
  overflow: hidden;
  font-size: 13px;
  font-weight: 500;
  line-height: 20px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.iw-turn-stat {
  display: inline-flex;
  gap: 6px;
  flex: none;
  font-family: var(--ds-font-family-code, ui-monospace, monospace);
  font-size: 10px;
  line-height: 16px;
  color: var(--dsw-alias-label-tertiary, inherit);
}
.iw-turn-add { color: var(--dsw-alias-state-success-primary, #3fa55a); }
.iw-turn-del { color: var(--dsw-alias-state-error-primary, #c95c5c); }
.iw-turn-rows { display: flex; flex-direction: column; border-top: 0.5px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.08)); }
.iw-turn-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  min-height: 24px;
  margin: 0;
  padding: 7px 18px 7px 14px;
  border: 0;
  background: transparent;
  color: var(--dsw-alias-label-tertiary, inherit);
  font-family: var(--ds-font-family-code, ui-monospace, monospace);
  font-size: 11px;
  line-height: 18px;
  text-align: left;
  cursor: pointer;
}
.iw-turn-row:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.05)); }
.iw-turn-row:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary, #4a7dff));
}
.iw-turn-row.busy { cursor: progress; }
.iw-turn-path {
  min-width: 0;
  overflow: hidden;
  font-family: var(--dsw-font-family, inherit);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.iw-turn-counts { display: inline-flex; flex: none; gap: 6px; white-space: nowrap; }
.iw-turn-fold {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  box-sizing: border-box;
  width: 100%;
  margin: 0;
  padding: 10px 18px 10px 14px;
  border: 0;
  background: transparent;
  color: var(--dsw-alias-label-tertiary, inherit);
  font: inherit;
  font-size: 12px;
  line-height: 18px;
  text-align: left;
  cursor: pointer;
}
.iw-turn-fold:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.05)); }


/* Mouse-gesture settings, kept in its own General-settings row. */
.iw-gesture-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 0;
  width: 100%;
}
.iw-gesture-item-text { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.iw-gesture-item-title { font-size: 13px; color: var(--dsw-alias-label-primary, inherit); }
.iw-gesture-item-hint { font-size: 11.5px; color: var(--dsw-alias-label-tertiary, inherit); }
.iw-gesture-btn {
  padding: 4px 12px;
  border: 0.5px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.1));
  border-radius: var(--dsw-radius-md, 8px);
  background: var(--dsw-alias-card-fill, transparent);
  color: var(--dsw-alias-label-primary, inherit);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}
.iw-gesture-btn:hover { background: var(--dsw-alias-card-fill-hover, rgba(255, 255, 255, 0.06)); }
.iw-gesture-panel {
  margin: 2px 0 10px;
  padding: 10px 12px;
  border: 0.5px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.1));
  border-radius: var(--dsw-radius-md, 8px);
  background: var(--dsw-alias-bg-layer-1, transparent);
}
.iw-gesture-hint { margin: 0 0 8px; font-size: 11.5px; color: var(--dsw-alias-label-tertiary, inherit); }
.iw-gesture-issue { margin-bottom: 8px; font-size: 12px; color: var(--dsw-alias-state-error-primary, #c95c5c); }
.iw-gesture-rows { display: flex; flex-direction: column; }
.iw-gesture-select {
  height: 24px;
  padding: 0 6px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.12));
  border-radius: 6px;
  background: var(--dsw-alias-bg-layer-2, #2a2e35);
  color: var(--dsw-alias-label-primary, #e6e8ec);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.iw-gesture-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 0;
  border-top: 0.5px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.06));
}
.iw-gesture-row:first-child { border-top: 0; }
.iw-gesture-label { font-size: 12.5px; color: var(--dsw-alias-label-primary, inherit); }
.iw-gesture-right { display: inline-flex; align-items: center; gap: 6px; }
.iw-gesture-keys {
  min-width: 72px;
  padding: 2px 8px;
  border-radius: var(--dsw-radius-sm, 6px);
  background: var(--dsw-alias-bg-base, rgba(255, 255, 255, 0.04));
  color: var(--dsw-alias-label-secondary, inherit);
  font-family: var(--ds-font-family-code, ui-monospace, monospace);
  font-size: 11.5px;
  text-align: center;
}
.iw-gesture-keys.readonly { opacity: 0.75; }
.iw-gesture-keys.recording { color: var(--dsw-alias-state-warning-primary, #d9a13b); }
.iw-gesture-chips { display: inline-flex; gap: 6px; }
.iw-gesture-chip {
  padding: 3px 10px;
  border: 0.5px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.1));
  border-radius: var(--dsw-radius-sm, 6px);
  background: transparent;
  color: var(--dsw-alias-label-secondary, inherit);
  font: inherit;
  font-size: 11.5px;
  cursor: pointer;
}
.iw-gesture-chip:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.05)); }
.iw-gesture-chip.active {
  border-color: var(--dsw-alias-state-business-primary, #4a7dff);
  color: var(--dsw-alias-state-business-primary, #4a7dff);
}
.iw-gesture-chip.taken { opacity: 0.35; cursor: not-allowed; }

.iw-turn-shell .iw-turn-shell-row {
  padding: 8px 14px;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary, inherit);
}

.iw-turn-status {
  flex: none;
  font-family: var(--ds-font-family-code, ui-monospace, monospace);
  font-size: 10px;
  line-height: 14px;
  min-width: 12px;
  text-align: center;
  border-radius: var(--dsw-radius-sm, 4px);
  color: var(--dsw-alias-label-tertiary, inherit);
}
.iw-turn-status.s-m { color: var(--dsw-alias-state-warning-primary, #d9a13b); }
.iw-turn-status.s-a { color: var(--dsw-alias-state-success-primary, #3fa55a); }
.iw-turn-status.s-d { color: var(--dsw-alias-state-error-primary, #c95c5c); }
.iw-turn-status.s-\? { color: var(--dsw-alias-label-tertiary, inherit); }

/* Floating quick-ask card (Doubao-style): over the workspace, above other panes. */
.iw-float {
  position: fixed;
  z-index: 60;
  cursor: default;
  box-sizing: border-box;
  /* The card is a fixed box: its body scrolls and nothing may paint outside. */
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px 12px;
  border: 0.5px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.12));
  border-radius: var(--dsw-radius-lg, 12px);
  background: var(--dsw-alias-bg-layer-1, rgba(30, 32, 36, 0.96));
  box-shadow: var(--dsw-elevation-prominent, 0 12px 32px rgba(0, 0, 0, 0.35));
  color: var(--dsw-alias-label-primary, inherit);
  font-family: inherit;
}
/* Every child measures like the card, or a 100%-wide textarea with its own
   padding pokes through the right border (rounded on one side, square on the other). */
.iw-float, .iw-float *, .iw-float *::before, .iw-float *::after { box-sizing: border-box; }
.iw-float-head { display: flex; align-items: center; gap: 6px; cursor: grab; user-select: none; touch-action: none; }
.iw-float-head:active { cursor: grabbing; }
.iw-float-collapsed {
  padding: 4px;
  border: 0;
  background: transparent;
  box-shadow: none;
  min-height: 0;
}
.iw-float-collapsed .iw-float-ball-btn { flex: 0 0 auto; }
.iw-float-chip {
  max-width: 168px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 2px 7px;
  border: 0.5px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.14));
  border-radius: 999px;
  background: transparent;
  color: var(--dsw-alias-label-secondary, inherit);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.iw-float-chip:hover { background: var(--dsw-alias-card-fill-hover, rgba(255, 255, 255, 0.08)); }
/* The command and mention lists sit above the composer, the way the
   conversation's own popup does: one row per candidate, description right. */
/* Tool steps and the running line, measured like the conversation's own. */
.iw-float-step { display: flex; gap: 6px; padding: 2px 0; }
.iw-float-step-icon,
.iw-float-thinking-icon {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  height: 22px;
  color: var(--dsw-alias-label-tertiary, #81858c);
}
.iw-float-step-text {
  font-size: 14px;
  line-height: 22px;
  color: var(--dsw-alias-label-secondary, #61666b);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.iw-float-step.live .iw-float-step-text { color: var(--dsw-alias-label-primary, #1a1a1a); }
/* The live Tool line is pinned under the scroll box, not part of the
   transcript: it truncates instead of widening the card. */
.iw-float-live .iw-float-step-text { min-width: 0; }

/* Folded rows: reasoning, context injections, finished Tool batches and every
   other log event — one line each, opened on demand. Without this the card
   showed the tool's name and nothing else. */
.iw-float-fold { display: flex; flex-direction: column; }
.iw-float-fold-head {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 2px 0;
  border: none;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #61666b);
  font: inherit;
  font-size: 14px;
  line-height: 22px;
  text-align: left;
  cursor: pointer;
}
.iw-float-fold-head:hover { color: var(--dsw-alias-label-primary, #1a1a1a); }
.iw-float-fold-icon,
.iw-float-fold-chevron {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  color: var(--dsw-alias-label-tertiary, #81858c);
}
.iw-float-fold-label { flex: 0 0 auto; }
.iw-float-fold-reasoning .iw-float-fold-label { color: var(--dsw-alias-label-tertiary, #81858c); }
.iw-float-fold-preview {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-tertiary, #81858c);
}
.iw-float-fold-chevron { transition: transform 120ms ease; }
.iw-float-fold.open .iw-float-fold-chevron { transform: rotate(180deg); }
.iw-float-fold-body { margin: 2px 0 6px 21px; }
.iw-float-fold-pre {
  margin: 0;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2, rgba(127, 127, 127, 0.08));
  color: var(--dsw-alias-label-secondary, #61666b);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11.5px;
  line-height: 19px;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 240px;
  overflow: auto;
}
.iw-float-thinking { display: flex; gap: 6px; padding: 2px 0; }
.iw-float-thinking-text { font-size: 14px; line-height: 22px; color: var(--dsw-alias-label-secondary, #61666b); }

/* The queue strip: messages waiting for the next turn, above the composer the
   way the conversation docks its own. */
.iw-float-queue {
  flex: 0 0 auto;
  margin: 0 12px 8px;
  border: 0.5px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.1));
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-1, #fff);
  overflow: hidden;
}
.iw-float-queue-head {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 7px 10px;
  border: none;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #61666b);
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.iw-float-queue-head:hover { background: var(--dsw-alias-card-fill-hover, rgba(127, 127, 127, 0.08)); }
.iw-float-queue-icon,
.iw-float-queue-chevron { display: inline-flex; align-items: center; flex: 0 0 auto; color: var(--dsw-alias-label-tertiary, #81858c); }
.iw-float-queue-chevron { margin-left: 2px; transition: transform 120ms ease; }
.iw-float-queue-chevron.on { transform: rotate(180deg); }
.iw-float-queue-count { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.iw-float-queue-list { display: flex; flex-direction: column; max-height: 120px; overflow-y: auto; }
.iw-float-queue-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  padding: 4px 10px;
  border-top: 0.5px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.1));
}
.iw-float-queue-row.sending { opacity: 0.7; }
.iw-float-queue-text {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-label-primary, #1a1a1a);
}
.iw-float-queue-sending { flex: 0 0 auto; font-size: 12px; color: var(--dsw-alias-label-tertiary, #81858c); }
.iw-float-queue-actions { display: flex; align-items: center; gap: 2px; flex: 0 0 auto; }
.iw-float-queue-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary, #81858c);
  cursor: pointer;
}
.iw-float-queue-action:hover:not(:disabled) {
  background: var(--dsw-alias-card-fill-hover, rgba(127, 127, 127, 0.08));
  color: var(--dsw-alias-label-primary, #1a1a1a);
}
.iw-float-queue-action:disabled { opacity: 0.4; cursor: default; }
.iw-float-queue-input {
  flex: 1 1 auto;
  min-width: 0;
  padding: 3px 8px;
  border: 0.5px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.16));
  border-radius: 6px;
  background: var(--dsw-alias-bg-layer-2, rgba(127, 127, 127, 0.06));
  color: var(--dsw-alias-label-primary, #1a1a1a);
  font: inherit;
  font-size: 13px;
}
.iw-float-queue-input:focus { outline: none; border-color: var(--dsw-alias-label-accent, #4d6bfe); }

/* While the Session works, the card says what it is doing and for how long. */
.iw-float-running {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  margin-top: 4px;
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-2, rgba(127, 127, 127, 0.08));
}
.iw-float-running-head { display: flex; align-items: center; gap: 6px; }
.iw-float-running-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--dsw-alias-label-accent, #4d6bfe);
  animation: iw-float-pulse 1.2s ease-in-out infinite;
}
@keyframes iw-float-pulse {
  0%, 100% { opacity: 0.35; }
  50% { opacity: 1; }
}
.iw-float-running-text { font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary, #61666b); }
.iw-float-running-detail {
  font-size: 12.5px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary, #81858c);
  font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.iw-float-running-step { display: flex; align-items: baseline; gap: 6px; }
.iw-float-running-step-text {
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-label-secondary, #61666b);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* The composer dropdown, measured off DSH's own menu: 4px padding, 34px rows,
   a 14px glyph seat, the alias beside the title and the description flushed
   right. */
.iw-float-suggest {
  position: absolute;
  left: 0;
  right: 0;
  bottom: calc(100% + 4px);
  z-index: 20;
  max-height: 240px;
  overflow-y: auto;
  padding: 4px;
  border: 0.5px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.08));
  border-radius: var(--dsw-radius-lg, 12px);
  /* --dsw-specific-menu is translucent (#fcfdfeb3) because DSH blurs what is
     behind it; the card has no backdrop filter, so on its own the menu would
     let the code show through. Opaque layer + border instead. */
  background: var(--dsw-alias-bg-layer-1, #fff);
  box-shadow: var(--dsw-elevation-prominent, 0 10px 24px rgba(0, 0, 0, 0.18));
}
.iw-float-suggest-item {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-height: 34px;
  padding: 6px 8px;
  border: 0;
  border-radius: var(--dsw-radius-md, 8px);
  background: transparent;
  color: var(--dsw-alias-label-primary, inherit);
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  text-align: left;
  cursor: pointer;
}
.iw-float-suggest-item.on { background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.12)); }
.iw-float-suggest-icon {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  color: var(--dsw-alias-menu-icon, var(--dsw-alias-label-tertiary, #81858c));
}
.iw-float-suggest-section {
  min-height: 23px;
  padding: 5px 8px 2px;
  font-size: 11px;
  font-weight: 500;
  line-height: 16px;
  color: var(--dsw-alias-label-tertiary, #81858c);
}
.iw-float-suggest-section:not(:first-child) { margin-top: 3px; }
.iw-float-suggest-name {
  flex: none;
  max-width: 40%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.iw-float-suggest-alias {
  flex: none;
  max-width: 20%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary, #81858c);
}
.iw-float-suggest-desc {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: right;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary, #81858c);
}
.iw-float-suggest-trailing {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  margin-left: auto;
}
.iw-float-suggest-key {
  padding: 0 4px;
  border-radius: var(--dsw-radius-xs, 4px);
  background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.12));
  color: var(--dsw-alias-label-caption, var(--dsw-alias-label-tertiary, #81858c));
  font-size: 10px;
  line-height: 16px;
}
/* A popup belongs to its trigger: the card used to lay menus out in its own
   column, so a menu opened at the top of the card, far from the chip. The
   coordinates are measured per open; this only takes the menu out of the flow. */
.iw-float-menu {
  position: absolute;
  z-index: 24;
}
/* A menu row must keep its name on one line: the card is narrow, the model
   names are not. */
.iw-float-menu-label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.iw-float-menu {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 200px;
  max-height: 260px;
  overflow-y: auto;
  padding: 5px;
  border: 0.5px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.14));
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1, #fff);
}
.iw-float-menu-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 30px;
  font-size: 13px;
  padding: 6px 8px;
  border: 0;
  border-radius: var(--dsw-radius-md, 8px);
  background: transparent;
  color: var(--dsw-alias-label-primary, inherit);
  font: inherit;
  font-size: 13px;
  line-height: 1.35;
  text-align: left;
  cursor: pointer;
}
.iw-float-menu-item:hover { background: var(--dsw-alias-card-fill-hover, rgba(255, 255, 255, 0.08)); }
/* The current entry reads as a selected row, the way DSH's own menus do. */
.iw-float-menu-item.on { background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.12)); }
.iw-float-menu-group { font-size: 12px; color: var(--dsw-alias-label-tertiary, inherit); white-space: nowrap; }
.iw-float-menu-empty { padding: 8px 10px; font-size: 14px; color: var(--dsw-alias-label-tertiary, inherit); }
/* Markdown tables: full width, scrolls sideways only when it must. */
/* Same table as the conversation's: hairline rows, no grid, 13px text. */
.iw-float-md-tablewrap { overflow-x: auto; margin: 8px 0; }
.iw-float-md-table {
  border-collapse: collapse;
  width: 100%;
  max-width: 100%;
  font-size: 13px;
  line-height: 22px;
}
.iw-float-md-table th,
.iw-float-md-table td {
  border: 0;
  border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(127, 127, 127, 0.22));
  padding: 10px 16px 10px 0;
  vertical-align: top;
  text-align: left;
  font-weight: 400;
}
.iw-float-md-table th { font-weight: 500; }
.iw-float-md-table tr:last-child td { border-bottom: 0; }
.iw-float-md-left { text-align: left; }
.iw-float-md-center { text-align: center; }
.iw-float-md-right { text-align: right; }
/* Task list rows and nested indents. */
.iw-float-md-task { list-style: none; display: flex; gap: 5px; align-items: baseline; }
.iw-float-md-check { color: var(--dsw-alias-label-secondary, inherit); }
.iw-float-md-done { opacity: 0.72; }
.iw-float-md-done .iw-float-md-check { color: var(--dsw-alias-state-success-primary, #3fa55a); }
.iw-float-pic-wait {
  width: 96px;
  height: 72px;
  border-radius: 6px;
  background: var(--dsw-alias-fill-l2, rgba(255, 255, 255, 0.06));
}
/* Images inside a message: a row of thumbnails, click nothing, just look. */
.iw-float-pics { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
.iw-float-pic {
  cursor: copy;
  max-width: 132px;
  max-height: 132px;
  border-radius: 6px;
  border: 0.5px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.16));
  object-fit: contain;
  background: rgba(0, 0, 0, 0.2);
}
/* Reference and image chips: the composer's own idea, in the card's scale. */
.iw-float-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
}
.iw-float-chip-ref {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  max-width: 100%;
  padding: 1px 2px 1px 7px;
  border-radius: 6px;
  background: var(--dsw-alias-blue-tint, rgba(64, 128, 255, 0.18));
  border: 0.5px solid var(--dsw-alias-blue-border, rgba(96, 150, 255, 0.55));
  color: var(--dsw-alias-label-link, #6ea8ff);
  font-size: 12px;
  line-height: 17px;
}
.iw-float-chip-ref-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 260px;
}
.iw-float-chip-image {
  position: relative;
  display: inline-flex;
  border-radius: 6px;
  overflow: hidden;
  border: 0.5px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.16));
}
.iw-float-chip-image img { width: 40px; height: 40px; object-fit: cover; display: block; }
.iw-float-chip-x {
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 11px;
  line-height: 14px;
  padding: 0 4px;
  cursor: pointer;
  opacity: 0.75;
}
.iw-float-chip-x:hover { opacity: 1; }
.iw-float-chip-image .iw-float-chip-x {
  position: absolute;
  top: 0;
  right: 0;
  padding: 0 3px;
  border-radius: 0 0 0 6px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
}
.iw-float-gap { flex: 1 1 auto; }
/* Window buttons: one glued pair pinned to the right edge. */
.iw-float-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-left: auto;
  flex: 0 0 auto;
}
.iw-float-plus { margin-left: 0; font-size: 15px; flex: 0 0 auto; }
.iw-float-perm { flex: 0 0 auto; }
.iw-float-foot { display: flex; align-items: center; gap: 6px; }
.iw-float-stop { background: var(--dsw-alias-state-error-primary, #c95c5c); }
.iw-float-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--dsw-alias-state-success-primary, #3fa55a);
}
.iw-float-title-caret {
  margin-left: 2px;
  font-size: 9px;
  opacity: 0.62;
}
.iw-float-new-btn {
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
  padding: 0;
  border: 0;
  border-radius: var(--dsw-radius-sm, 6px);
  background: transparent;
  color: var(--dsw-alias-label-secondary, inherit);
  font: inherit;
  font-size: 14px;
  line-height: 16px;
  cursor: pointer;
}
.iw-float-new-btn:hover { background: var(--dsw-alias-card-fill-hover, rgba(255, 255, 255, 0.1)); }
.iw-float-title-btn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  min-width: 0;
  max-width: 46%;
  flex: 0 1 auto;
  padding: 1px 4px;
  border: 0;
  border-radius: var(--dsw-radius-sm, 6px);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  overflow: hidden;
}
/* The label truncates; the caret must never be the thing that gets clipped. */
.iw-float-title-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.iw-float-title-btn:hover { background: var(--dsw-alias-card-fill-hover, rgba(255, 255, 255, 0.08)); }
/* A model row must be clickable across its whole width, not just on the text. */
.iw-float-menu-item {
  width: 100%;
  min-height: 30px;
  justify-content: space-between;
  text-align: left;
}
.iw-float-menu-head {
  padding: 6px 10px 2px;
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary, inherit);
}
.iw-float-menu { align-items: stretch; }
.iw-float-sessions .iw-float-menu-item { justify-content: flex-start; }
/* The new-session action stays reachable while the grouped list scrolls. */
.iw-float-menu-new {
  position: sticky;
  top: -5px;
  z-index: 1;
  margin: -5px -5px 2px;
  border-radius: 6px;
  background: var(--dsw-alias-bg-layer-2, rgba(20, 21, 24, 0.98));
  color: var(--dsw-alias-label-primary, inherit);
  font-weight: 600;
}
/* One workspace per section: a sticky-ish label, then its conversations. */
.iw-float-group-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 10px 3px;
  font-size: 11px;
  letter-spacing: 0.02em;
  color: var(--dsw-alias-label-tertiary, inherit);
  text-transform: none;
}
.iw-float-group-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.iw-float-group-badge {
  flex: 0 0 auto;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--dsw-alias-state-success-primary, #3fa55a);
  color: #fff;
  font-size: 10px;
  line-height: 15px;
}
.iw-float-group-current > .iw-float-group-head { color: var(--dsw-alias-label-secondary, inherit); }
.iw-float-title {
  font-size: 14px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 150px;
}
.iw-float-model { font-size: 11px; color: var(--dsw-alias-label-tertiary, inherit); }
.iw-float-icon {
  margin-left: auto;
  width: 20px;
  height: 20px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary, inherit);
  font: inherit;
  line-height: 1;
  cursor: pointer;
}
.iw-float-icon:hover { background: var(--dsw-alias-card-fill-hover, rgba(255, 255, 255, 0.08)); }
.iw-float-body {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 20px;
  /* A flex item's automatic minimum is its content, which pushed the composer
     below the card's border once the transcript grew. */
  min-height: 0;
  overflow-y: auto;
  padding: 2px 0;
}
.iw-float-empty { font-size: 12px; color: var(--dsw-alias-label-tertiary, inherit); padding: 6px 0; }
/* Transcript rows, shaped like the conversation: the user side is a
   right-aligned bubble with a clock under it, the assistant side is plain
   full-width markdown. Measured off DSH: bubble 20px corners, 10px 16px,
   14px/22px; body 14px/24px with 16px paragraph rhythm. */
.iw-float-row { display: flex; flex-direction: column; }
.iw-float-assistant {
  font-size: 14px;
  line-height: 24px;
}
.iw-float-user {
  align-items: flex-end;
  gap: 6px;
  font-size: 14px;
  line-height: 22px;
}
.iw-float-bubble {
  max-width: min(477px, 82%);
  padding: 10px 16px;
  border-radius: var(--dsw-radius-xl, 20px);
  background: var(--dsw-specific-bubble, #edf3fe);
  color: var(--dsw-alias-label-primary, inherit);
  font-size: 14px;
  line-height: 22px;
  word-break: break-word;
}
.iw-float-bubble .iw-float-md { line-height: 22px; }
/* An open question is a card, matching the conversation's own: an 11px eyebrow,
   a 16px question, numbered options, and the way back to the conversation. */
.iw-float-ask {
  align-self: stretch;
  border-radius: 16px;
  background: var(--dsw-alias-bg-layer-1, #ffffff);
  /* The conversation's card has no border: a hairline ring plus two soft
     shadows is what lifts it off the page. */
  box-shadow: 0 0 0 0.5px var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.1)), 0 3px 8px rgba(0, 0, 0, 0.03), 0 0 16px rgba(0, 0, 0, 0.02);
  padding: 14px 16px 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.iw-float-ask-head { display: flex; flex-direction: column; gap: 2px; }
.iw-float-ask-eyebrow { font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-tertiary, #81858c); }
.iw-float-ask-title { font-size: 16px; line-height: 24px; color: var(--dsw-alias-label-primary, inherit); }
.iw-float-ask-options { display: flex; flex-direction: column; gap: 8px; }
.iw-float-ask-option {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px 8px 8px;
  border-radius: 12px;
}
.iw-float-ask-index {
  flex: 0 0 auto;
  width: 20px;
  height: 20px;
  border-radius: 4px;
  background: var(--dsw-alias-bg-layer-3, rgba(0, 0, 0, 0.06));
  color: var(--dsw-alias-label-secondary, #61666b);
  font-size: 12px;
  line-height: 20px;
  text-align: center;
}
.iw-float-ask-label { font-size: 14px; line-height: 22px; color: var(--dsw-alias-label-primary, inherit); }
.iw-float-ask-desc { font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-tertiary, #81858c); }
.iw-float-ask-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.iw-float-ask-hint { font-size: 12.5px; line-height: 18px; color: var(--dsw-alias-label-tertiary, #81858c); }
.iw-float-ask-go { flex: 0 0 auto; }
/* The问答 card, borrowed from the conversation: the bubble is the user's own,
   header and question in the secondary colour, the picked answer in primary. */
.iw-float-question { display: flex; flex-direction: column; }
.iw-float-q-head { font-size: 12.5px; line-height: 20px; color: var(--dsw-alias-label-tertiary, #81858c); }
.iw-float-q-ask { font-size: 14px; line-height: 22px; color: var(--dsw-alias-label-secondary, #61666b); }
.iw-float-q-answer { font-size: 14px; line-height: 22px; color: var(--dsw-alias-label-primary, inherit); margin-top: 4px; }
.iw-float-q-wait { font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-tertiary, #81858c); margin-top: 4px; }
.iw-float-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--dsw-alias-label-tertiary, #81858c);
}
.iw-float-clock { font-size: 13px; line-height: 20px; }
.iw-float-copy {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 20px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary, #81858c);
  cursor: pointer;
}
.iw-float-copy:hover { background: var(--dsw-alias-bg-layer-3, rgba(127, 127, 127, 0.12)); }
.iw-float-text {
  font-size: 14px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}
.iw-float-md { font-size: 14px; line-height: 24px; word-break: break-word; }
.iw-float-md-p { margin: 16px 0; }
.iw-float-md-p:first-child { margin-top: 0; }
.iw-float-md-p:last-child { margin-bottom: 0; }
.iw-float-md-h { margin: 32px 0 16px; font-weight: 600; line-height: 1.3; }
.iw-float-md-h4, .iw-float-md-h5, .iw-float-md-h6 { margin: 16px 0; }
.iw-float-md-h1 { font-size: 24px; }
.iw-float-md-h2 { font-size: 20px; }
.iw-float-md-h3 { font-size: 16px; }
.iw-float-md-h4 { font-size: 14px; }
.iw-float-md-h5, .iw-float-md-h6 { font-size: 14px; }
.iw-float-md-list { margin: 16px 0; padding-left: 18px; }
.iw-float-md-list li { margin: 0; }
.iw-float-md-list li:not(:first-child) { margin-top: 6px; }
/* Inline code, measured off the conversation's own rule (not-pre > code):
   inline-flex keeps the snippet on one line instead of breaking a path
   mid-word, 0.875em + a 0.5px hairline + 8px corners. */
.iw-float-md-code {
  display: inline-flex;
  align-items: center;
  box-sizing: border-box;
  padding: 0 5px;
  border-radius: var(--dsw-radius-sm, 8px);
  border: 0.5px solid var(--dsw-alias-border-l1, rgba(127, 127, 127, 0.24));
  background: var(--dsw-alias-markdown-inline-code, color-mix(in srgb, currentColor 7%, transparent));
  font-family: var(--ds-font-family-code, "SF Mono", ui-monospace, Menlo, monospace);
  font-size: 0.875em;
  line-height: inherit;
  color: inherit;
}
/* The conversation keeps the same 0.875em inside tables (11.375px at 13px). */
.iw-float-md-table code { font-size: 0.875em; }
.iw-float-md-link { color: var(--dsw-alias-brand-primary, #4b8bf5); text-decoration: none; }
.iw-float-md-link:hover { text-decoration: underline; }
/* Shaped like the conversation's block: 16px corners, a 42px header with the
   block name on the left and wrap/copy on the right, 11px/19px SF Mono body. */
.iw-float-md-codeblock {
  margin: 8px 0;
  border-radius: 16px;
  overflow: hidden;
  background: color-mix(in srgb, var(--dsw-alias-label-primary, #0f1115) 4%, transparent);
}
.iw-float-md-codehead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 42px;
  padding: 0 10px 0 22px;
  color: var(--dsw-alias-label-tertiary, inherit);
  font-size: 11px;
}
.iw-float-md-codelang { color: var(--dsw-alias-label-tertiary, inherit); }
.iw-float-md-codeacts { display: flex; align-items: center; gap: 2px; }
.iw-float-md-codeact {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary, inherit);
  cursor: pointer;
}
.iw-float-md-codeact:hover {
  color: var(--dsw-alias-label-primary, inherit);
  background: color-mix(in srgb, var(--dsw-alias-label-primary, #0f1115) 8%, transparent);
}
.iw-float-md-codeact.on { color: var(--dsw-alias-label-primary, inherit); }
.iw-float-md-pre {
  margin: 0;
  padding: 6px 22px 20px;
  overflow-x: hidden;
  overflow-y: auto;
  max-height: 260px;
  font-family: var(--ds-font-family-code, "SF Mono", "JetBrains Mono", ui-monospace, Menlo, monospace);
  font-size: 11px;
  line-height: 19px;
  color: var(--dsw-alias-label-primary, inherit);
}
.iw-float-md-line { white-space: pre; }
.iw-float-md-wrapped .iw-float-md-line { white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; }
/* Long code lines wrap inside the narrow card instead of scrolling sideways. */
.iw-float-md-quote {
  margin: 6px 0;
  padding-left: 8px;
  border-left: 2px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.18));
  color: var(--dsw-alias-label-secondary, inherit);
}
.iw-float-md-hr { height: 1px; margin: 8px 0; background: var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.1)); }
.iw-float-md-img {
  display: block;
  max-width: 100%;
  margin: 6px 0;
  border-radius: 6px;
  border: 0.5px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.1));
}
.iw-float-filelist { display: flex; flex-direction: column; gap: 4px; }
.iw-float-file {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  border: 0.5px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.1));
  border-radius: 8px;
  background: var(--dsw-alias-card-fill, rgba(255, 255, 255, 0.05));
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.iw-float-file:hover { background: var(--dsw-alias-card-fill-hover, rgba(255, 255, 255, 0.09)); }
/* One line per file: the name takes the room, the counts sit at the right edge
   where the eye scans for them. */
.iw-float-file-name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11.5px;
  font-weight: 600;
}
.iw-float-file-desc {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  max-width: 55%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-tertiary, inherit);
}
.iw-float-add { color: var(--dsw-alias-state-success-primary, #3fa55a); }
.iw-float-del { color: var(--dsw-alias-state-danger-primary, #e5534b); }
.iw-float-running { font-size: 11.5px; color: var(--dsw-alias-label-tertiary, inherit); }
/* The composer, shaped like DSH's own: one round container holding the field
   and a control row — attach, permission, model, round send. */
.iw-float-input {
  /* The suggestion list is absolutely positioned above this box, so the box is
     its containing block. */
  position: relative;
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  gap: 6px;
  padding: 10px 10px 8px 14px;
  border: 0.5px solid var(--dsw-alias-border-l1, rgba(127, 127, 127, 0.22));
  border-radius: 16px;
  background: var(--dsw-alias-bg-layer-1, transparent);
}
.iw-float-textarea {
  width: 100%;
  min-height: 44px;
  max-height: 140px;
  resize: none;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--dsw-alias-label-primary, inherit);
  font: inherit;
  font-size: 14px;
  line-height: 22px;
}
.iw-float-textarea::placeholder { color: var(--dsw-alias-label-tertiary, inherit); }
.iw-float-textarea:focus { outline: none; }
.iw-float-foot { display: flex; align-items: center; gap: 6px; }
.iw-float-plus {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  flex: 0 0 auto;
  padding: 0;
  border: 0.5px solid var(--dsw-alias-border-l1, rgba(127, 127, 127, 0.22));
  border-radius: 50%;
  background: transparent;
  color: var(--dsw-alias-label-secondary, inherit);
  cursor: pointer;
}
.iw-float-plus:hover { background: var(--dsw-alias-card-fill-hover, rgba(127, 127, 127, 0.1)); }
.iw-float-perm {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
  max-width: 46%;
  padding: 4px 8px;
  border: 0.5px solid var(--dsw-alias-border-l1, rgba(127, 127, 127, 0.22));
  border-radius: 999px;
  background: transparent;
  color: var(--dsw-alias-label-secondary, inherit);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.iw-float-perm:hover { background: var(--dsw-alias-card-fill-hover, rgba(127, 127, 127, 0.1)); }
.iw-float-perm-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.iw-float-foot-chip {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  flex: 0 1 auto;
  min-width: 0;
  padding: 4px 6px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-secondary, inherit);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.iw-float-foot-chip:hover { background: var(--dsw-alias-card-fill-hover, rgba(127, 127, 127, 0.1)); }
.iw-float-foot-chip-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 220px;
}
.iw-float-foot-model { max-width: 46%; }
.iw-float-send {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  flex: 0 0 auto;
  margin-left: 2px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: var(--dsw-alias-bg-accent, #3b6ef0);
  color: #fff;
  cursor: pointer;
}
.iw-float-send:hover { filter: brightness(1.06); }
.iw-float-send:disabled { opacity: 0.8; cursor: default; filter: none; }
.iw-float-stop { background: var(--dsw-alias-label-primary, #333); color: var(--dsw-alias-bg-layer-1, #fff); }
/* Resize: four edge strips plus a marked corner. The strips are invisible but
   wide enough to hit, and each carries the cursor the edge implies. */
.iw-float-grip { position: absolute; touch-action: none; z-index: 2; }
.iw-float-grip-n { top: 0; left: 8px; right: 8px; height: 5px; cursor: ns-resize; }
.iw-float-grip-s { bottom: 0; left: 8px; right: 8px; height: 5px; cursor: ns-resize; }
.iw-float-grip-w { left: 0; top: 8px; bottom: 8px; width: 5px; cursor: ew-resize; }
.iw-float-grip-e { right: 0; top: 8px; bottom: 8px; width: 5px; cursor: ew-resize; }
.iw-float-resize {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 18px;
  height: 18px;
  cursor: nwse-resize;
  touch-action: none;
  z-index: 3;
  opacity: 0.75;
  background:
    linear-gradient(135deg, transparent 0 42%, currentColor 42% 47%, transparent 47% 62%, currentColor 62% 67%, transparent 67% 100%);
  color: var(--dsw-alias-label-tertiary, rgba(255, 255, 255, 0.5));
  border-bottom-right-radius: var(--dsw-radius-lg, 12px);
}
.iw-float-resize:hover { opacity: 1; background-color: var(--dsw-alias-card-fill-hover, rgba(255, 255, 255, 0.08)); }
.iw-float-ball-btn {
  width: 44px;
  height: 44px;
  border: 0.5px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.16));
  border-radius: 50%;
  background: var(--dsw-alias-bg-layer-1, rgba(30, 32, 36, 0.96));
  box-shadow: var(--dsw-elevation-prominent, 0 10px 24px rgba(0, 0, 0, 0.35));
  color: var(--dsw-alias-label-primary, inherit);
  font: inherit;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
}

/* The plugin's own settings section: a page, not a row inside 通用设置. */
.iw-settings-section {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px 0 16px;
  max-width: 720px;
}
.iw-settings-section .iw-settings-item:first-child { border-top: 0; padding-top: 0; }
.iw-settings-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 0;
  border-top: 0.5px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.06));
}
.iw-settings-item:first-child { border-top: 0; }
.iw-settings-item-label { font-size: 12.5px; color: var(--dsw-alias-label-primary, inherit); }
.iw-settings-group {
  margin: 10px 0 2px;
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary, inherit);
}
.iw-settings-body {
  padding: 4px 0 8px 10px;
  border-left: 1.5px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.08));
}

/* Tab context menu: DSH's menu surface, with the panel's own typography. */
.iw-menu-backdrop {
  position: absolute;
  inset: 0;
  z-index: 70;
  background: transparent;
}
.iw-menu {
  position: fixed;
  overflow-y: auto;
  overscroll-behavior: contain;
  min-width: 232px;
  padding: 5px;
  border: 0.5px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.1));
  border-radius: var(--dsw-radius-md, 10px);
  background: var(--dsw-specific-menu, var(--dsw-alias-bg-layer-2, #23262b));
  backdrop-filter: var(--dsw-menu-backdrop-filter, none);
  box-shadow: var(--dsw-elevation-prominent, 0 12px 32px rgba(0, 0, 0, 0.35));
  color: var(--dsw-alias-label-primary, inherit);
}
.iw-menu-item {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  height: 27px;
  padding: 0 9px;
  border: 0;
  border-radius: var(--dsw-radius-sm, 6px);
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 12.5px;
  line-height: 27px;
  text-align: left;
  cursor: pointer;
}
.iw-menu-item:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.08)); }
.iw-menu-item:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary, #4a7dff));
}
.iw-menu-icon {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 14px;
  color: var(--dsw-alias-label-secondary, inherit);
}
.iw-menu-label { flex: 1 1 auto; }
/* A labelled group inside a menu (the tree menu's Git section). */
.iw-menu-section {
  padding: 8px 9px 3px;
  color: var(--dsw-alias-label-secondary, #98a0ad);
  font-size: 11px;
  letter-spacing: 0.04em;
}

/* Centered overlay for the tree menu's difference view and pickers. */
.iw-overlay {
  position: fixed;
  inset: 0;
  z-index: 90;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.35);
}
.iw-overlay .iw-pop {
  position: static;
  width: min(940px, 92vw);
  max-height: min(76vh, 860px);
}
.iw-overlay .iw-diff-body,
.iw-overlay .iw-pick-body { flex: 1 1 auto; min-height: 0; }
.iw-pop-close {
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #98a0ad);
  font-size: 15px;
  line-height: 18px;
  padding: 0 6px;
  cursor: pointer;
}
.iw-pop-close:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.08)); }
.iw-diff-body {
  overflow: auto;
  padding: 6px 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  line-height: 1.55;
}
.iw-diff-line { padding: 0 12px; white-space: pre; }
.iw-diff-line.add { background: rgba(80, 180, 110, 0.16); }
.iw-diff-line.del { background: rgba(220, 90, 90, 0.16); }
.iw-diff-line.hunk { color: var(--dsw-alias-label-secondary, #98a0ad); }
.iw-pick-body { overflow: auto; padding: 4px; }
.iw-pick-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  padding: 7px 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.iw-pick-row:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.08)); }
.iw-pick-main { font-family: ui-monospace, monospace; font-size: 12.5px; }
.iw-pick-sub { color: var(--dsw-alias-label-secondary, #98a0ad); font-size: 11.5px; }

.iw-menu-sep {
  height: 0.5px;
  margin: 5px 8px;
  background: var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.08));
}

/* ---- Setup guide (LSP seam missing) -------------------------------------- */
.iw-setup-backdrop {
  position: absolute;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
}
.iw-setup {
  width: min(640px, calc(100% - 48px));
  max-height: calc(100% - 64px);
  overflow: auto;
  padding: 22px 24px 18px;
  border: 0.5px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.1));
  border-radius: var(--dsw-radius-lg, 14px);
  background: var(--dsw-specific-menu, var(--dsw-alias-bg-layer-2, #23262b));
  box-shadow: var(--dsw-elevation-prominent, 0 12px 32px rgba(0, 0, 0, 0.35));
  color: var(--dsw-alias-label-primary, #e6e8ec);
  font-size: 13px;
  line-height: 1.7;
}
.iw-setup-title {
  margin-bottom: 10px;
  font-size: 15px;
  font-weight: 600;
}
.iw-setup-body p {
  margin: 0 0 8px;
  color: var(--dsw-alias-label-secondary, #98a0ad);
}
.iw-setup-steps {
  margin: 0 0 6px;
  padding-left: 20px;
  color: var(--dsw-alias-label-secondary, #98a0ad);
}
.iw-setup-steps li { margin-bottom: 6px; }
.iw-setup-step-label {
  margin-bottom: 4px;
  line-height: 1.45;
}
.iw-setup-code + .iw-setup-code {
  margin-top: 6px;
}
.iw-setup-code {
  margin: 10px 0 12px;
  padding: 10px 12px;
  border-radius: var(--dsw-radius-sm, 6px);
  background: var(--dsw-alias-bg-layer-1, #1b1d22);
  overflow-x: auto;
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  font-size: 11.5px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.iw-setup-link {
  margin-bottom: 12px;
  color: var(--dsw-alias-label-secondary, #98a0ad);
}
.iw-setup-link a { color: var(--dsw-alias-brand-primary, #5b9dff); }
.iw-setup-still {
  margin-bottom: 12px;
  color: #e0a35c;
}
.iw-setup-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

/* ---- colour theme switcher (bottom-right corner of the status bar) ----
   The palettes live in themes/*.css and only override the alias tokens these
   rules consume, so nothing here knows which theme is active. */
.iw-theme-host {
  position: relative;
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
}
.iw-theme-button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 20px;
  padding: 0 6px;
  border: 1px solid transparent;
  border-radius: var(--dsw-radius-sm, 4px);
  background: transparent;
  color: var(--dsw-alias-label-secondary, #98a0ad);
  font: inherit;
  font-size: 11.5px;
  cursor: pointer;
}
.iw-theme-button:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.14));
  color: var(--dsw-alias-label-primary, #e6e8ec);
}
.iw-theme-button[aria-expanded="true"] {
  background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.14));
  border-color: var(--dsw-alias-border-l1, #2c3038);
}
.iw-theme-swatch {
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--dsw-alias-bg-base, #1b1d21) 50%, var(--dsw-alias-brand-primary, #4f8cff) 50%);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--dsw-alias-label-primary, #e6e8ec) 30%, transparent);
}
.iw-theme-pop {
  /* Anchored to the panel, not the status bar: the bar clips overflow, so the
     list would be cut off at the bottom edge. */
  position: absolute;
  right: 12px;
  bottom: 34px;
  width: 236px;
  max-height: min(62vh, 460px);
  overflow-y: auto;
  padding: 6px;
  box-sizing: border-box;
  border: 1px solid var(--dsw-alias-border-l1, #2c3038);
  border-radius: var(--dsw-radius-md, 8px);
  /* A solid surface: the menu token is translucent in some DSH themes, and the
     source would show through the list. */
  background: var(--dsw-alias-bg-layer-2, var(--dsw-specific-menu, #23262c));
  box-shadow: var(--dsw-elevation-prominent, 0 10px 28px rgba(0, 0, 0, 0.35));
  backdrop-filter: var(--dsw-menu-backdrop-filter, none);
  z-index: 30;
}
.iw-theme-title {
  padding: 4px 8px 6px;
  color: var(--dsw-alias-label-secondary, #98a0ad);
  font-size: 12px;
  font-weight: 500;
}
.iw-theme-group {
  padding: 8px 8px 4px;
  color: var(--dsw-alias-label-tertiary, #767f8c);
  font-size: 11px;
}
.iw-theme-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 26px;
  padding: 0 8px;
  box-sizing: border-box;
  border: 0;
  border-radius: var(--dsw-radius-sm, 4px);
  background: transparent;
  color: var(--dsw-alias-label-primary, #e6e8ec);
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.iw-theme-row:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.14));
}
.iw-theme-row--on {
  background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.14));
}
.iw-theme-name {
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.iw-theme-check {
  color: var(--dsw-alias-brand-primary, #4f8cff);
  font-size: 11px;
}
.iw-theme-dot {
  width: 10px;
  height: 10px;
  flex: 0 0 auto;
  border-radius: 50%;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--dsw-alias-label-primary, #e6e8ec) 24%, transparent);
}
/* One dot per palette: the same colours the theme file applies. */
.iw-theme-dot--follow { background: linear-gradient(135deg, #1b1d21 50%, #f3f4f6 50%); }
.iw-theme-dot--material-oceanic { background: #0f111a; }
.iw-theme-dot--material-palenight { background: #292d3e; }
.iw-theme-dot--dracula { background: #282a36; }
.iw-theme-dot--monokai-pro { background: #2d2a2e; }
.iw-theme-dot--night-owl { background: #011627; }
.iw-theme-dot--material-light { background: #fafafa; }
.iw-theme-dot--github-light { background: #ffffff; }
.iw-theme-dot--atom-one-light { background: #f0f0f1; }
.iw-theme-dot--solarized-light { background: #fdf6e3; }
.iw-theme-dot--intellij-light { background: #f7f8fa; }

/* ---- screenshot: veil, permission card, editor ---- */
.iw-shot-veil {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
  z-index: 60;
}
.iw-shot-veil--editor {
  flex-direction: column;
  gap: 0;
  padding: 0;
  box-sizing: border-box;
  background: #000;
  outline: none;
  overflow: hidden;
}
.iw-shot {
  width: 420px;
  max-width: calc(100% - 32px);
  padding: 14px;
  box-sizing: border-box;
  border: 1px solid var(--dsw-alias-border-l1, #2c3038);
  border-radius: var(--dsw-radius-lg, 10px);
  background: var(--dsw-alias-bg-layer-2, #23262c);
  box-shadow: var(--dsw-elevation-prominent, 0 12px 32px rgba(0, 0, 0, 0.4));
}
.iw-shot-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary, #e6e8ec);
}
.iw-shot-guide {
  margin-top: 8px;
  color: var(--dsw-alias-label-secondary, #98a0ad);
  font-size: 12px;
  line-height: 1.6;
}
.iw-shot-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}
.iw-shot-actions--bar {
  margin-top: 0;
}
.iw-shot-button,
.iw-shot-primary {
  height: 28px;
  padding: 0 12px;
  border-radius: var(--dsw-radius-sm, 4px);
  border: 1px solid var(--dsw-alias-border-l1, #2c3038);
  background: transparent;
  color: var(--dsw-alias-label-primary, #e6e8ec);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.iw-shot-button:disabled {
  opacity: 0.45;
  cursor: default;
}
.iw-shot-primary {
  border-color: transparent;
  background: var(--dsw-alias-brand-primary, #4f8cff);
  color: #fff;
}
.iw-shot-button:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.16));
}
.iw-shot-card {
  position: fixed;
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  gap: 4px;
  padding: 5px 6px;
  box-sizing: border-box;
  border-radius: var(--dsw-radius-md, 8px);
  background: var(--dsw-alias-bg-layer-2, #23262c);
  border: 1px solid var(--dsw-alias-border-l1, #2c3038);
  box-shadow: var(--dsw-elevation-prominent, 0 10px 28px rgba(0, 0, 0, 0.45));
  color: var(--dsw-alias-label-primary, #e6e8ec);
  z-index: 62;
}
.iw-shot-tool,
.iw-shot-card .iw-shot-button,
.iw-shot-card .iw-shot-primary {
  flex: 0 0 auto;
  white-space: nowrap;
}
.iw-shot-card .iw-btn {
  flex: 0 0 auto;
  white-space: nowrap;
  font-size: inherit;
}
.iw-shot-card .iw-sep {
  width: 1px;
  height: 16px;
  margin: 0 2px;
  flex: 0 0 auto;
  background: var(--dsw-alias-border-l1, #2c3038);
}
.iw-shot-grow {
  flex: 1;
}
.iw-shot-hint {
  color: var(--dsw-alias-label-secondary, #98a0ad);
}
.iw-shot-hint--top {
  padding: 0 4px 2px;
  text-align: center;
}
.iw-shot-stage {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  min-height: 0;
  width: 100%;
  touch-action: none;
  cursor: crosshair;
}
.iw-shot-frame {
  position: relative;
  display: block;
  flex: 0 0 auto;
}
.iw-shot-canvas {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: 4px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
}
/* The text box has to sit *on* the picture without covering it: no fill, no
   chrome, just a hairline so the caret has somewhere to live. Its colour is the
   annotation colour, so what you type looks like the mark you will get. */
.iw-shot-text {
  position: absolute;
  min-width: 0;
  margin: 0;
  padding: 1px 2px;
  border: 1px dashed color-mix(in srgb, currentColor 55%, transparent);
  border-radius: 3px;
  background: transparent;
  color: currentColor;
  font-family: -apple-system, "Segoe UI", "PingFang SC", sans-serif;
  font-weight: 600;
  line-height: 1.25;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.7);
  caret-color: currentColor;
  outline: none;
}
.iw-shot-text::placeholder {
  color: currentColor;
  opacity: 0.45;
  font-weight: 400;
}

/* Full-size picture viewer over the card. */
.iw-float-viewer {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border-radius: inherit;
  background: var(--dsw-alias-bg-layer-1, rgba(20, 21, 24, 0.97));
}
.iw-float-viewer-img {
  flex: 1 1 auto;
  min-height: 0;
  width: 100%;
  object-fit: contain;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.25);
}
.iw-float-viewer-bar { display: flex; align-items: center; gap: 8px; }
.iw-float-viewer-name { flex: 1 1 auto; font-size: 11.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* Markdown files render as a document in the code view. */
.iw-md { display: flex; flex-direction: column; min-height: 0; flex: 1 1 auto; overflow-y: auto; padding: 6px 18px 24px; }
.iw-md-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 12px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.1));
  font-size: 12.5px;
  color: var(--dsw-alias-label-secondary, inherit);
}
.iw-md-bar { justify-content: flex-end; }
.iw-md-body { max-width: 860px; width: 100%; }
.iw-md-body .iw-float-md { font-size: 14px; line-height: 1.7; }
.iw-md-body .iw-float-md-h1 { font-size: 22px; margin: 18px 0 10px; }
.iw-md-body .iw-float-md-h2 { font-size: 18px; margin: 16px 0 8px; }
.iw-md-body .iw-float-md-h3 { font-size: 16px; margin: 14px 0 6px; }
.iw-md-body .iw-float-md-p { margin: 8px 0; }
.iw-md-body .iw-float-md-list { margin: 6px 0; padding-left: 22px; }
.iw-md-body .iw-float-md-table { font-size: 13px; }
.iw-md-body .iw-float-md-pre { font-size: 11px; }
`

/** Render the stylesheet as a React element so unmounting removes it. */
function IdeStyles() {
  return h('style', { key: 'dsh-ide-window:css' }, IDE_CSS)
}
