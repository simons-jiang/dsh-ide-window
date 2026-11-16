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
.iw-kw { color: #cf8ee6; }
.iw-str { color: #9ddc8b; }
.iw-num { color: #e0b072; }
.iw-com { color: #6d7683; font-style: italic; }
.iw-ann { color: #e0c56b; }
.iw-type { color: #7fc8f0; }
.iw-fn { color: #8fd7d0; }
.iw-punct { color: var(--dsw-alias-label-secondary, #98a0ad); }
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
  font-size: 12px;
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
.iw-menu-sep {
  height: 0.5px;
  margin: 5px 8px;
  background: var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.08));
}
`

/** Render the stylesheet as a React element so unmounting removes it. */
function IdeStyles() {
  return h('style', { key: 'dsh-ide-window:css' }, IDE_CSS)
}
