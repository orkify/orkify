export function getStyles(primaryColor: string): string {
  return `
    :host {
      all: initial;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      font-size: 14px;
      line-height: 1.5;
      color: hsl(224 71% 4%);
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    /* ── Launcher ── */
    .orkify-launcher {
      position: fixed;
      bottom: 20px;
      right: 20px;
      width: 56px;
      height: 56px;
      border-radius: 9999px;
      background: ${primaryColor};
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 20px 40px -10px rgba(0,0,0,0.3), 0 8px 16px -6px rgba(0,0,0,0.2), 0 2px 4px -1px rgba(0,0,0,0.1);
      transition: transform 0.15s cubic-bezier(0.4,0,0.2,1),
                  box-shadow 0.15s cubic-bezier(0.4,0,0.2,1);
      z-index: 2147483646;
    }

    .orkify-launcher:hover {
      transform: scale(1.05);
      box-shadow: 0 25px 50px -12px rgba(0,0,0,0.35), 0 12px 24px -8px rgba(0,0,0,0.25), 0 4px 8px -2px rgba(0,0,0,0.15);
    }

    .orkify-launcher:active { transform: scale(0.95); }

    .orkify-launcher svg {
      width: 24px;
      height: 24px;
      fill: white;
      transition: transform 0.2s cubic-bezier(0.4,0,0.2,1), opacity 0.15s;
    }

    .orkify-launcher .orkify-icon-close {
      position: absolute;
      opacity: 0;
      transform: rotate(-90deg) scale(0.5);
    }

    .orkify-launcher.open .orkify-icon-chat {
      opacity: 0;
      transform: rotate(90deg) scale(0.5);
    }

    .orkify-launcher.open .orkify-icon-close {
      opacity: 1;
      transform: rotate(0deg) scale(1);
    }

    .orkify-unread {
      display: none;
      position: absolute;
      top: 2px;
      right: 2px;
      width: 12px;
      height: 12px;
      background: hsl(0 72% 51%);
      border-radius: 9999px;
      pointer-events: none;
    }

    .orkify-has-unread .orkify-unread { display: block; }
    .orkify-has-unread.open .orkify-unread { display: none; }

    /* ── Panel ── */
    .orkify-panel {
      position: fixed;
      bottom: 88px;
      right: 20px;
      width: 380px;
      max-height: 700px;
      background: hsl(0 0% 100%);
      border-radius: 16px;
      box-shadow: 0 40px 80px -20px rgba(0,0,0,0.35), 0 20px 40px -12px rgba(0,0,0,0.25), 0 6px 12px -3px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.07);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      z-index: 2147483647;
      opacity: 0;
      transform: translateY(12px) scale(0.97);
      pointer-events: none;
      transition: opacity 0.2s cubic-bezier(0.4,0,0.2,1),
                  transform 0.2s cubic-bezier(0.4,0,0.2,1);
    }

    .orkify-panel.open {
      opacity: 1;
      transform: translateY(0) scale(1);
      pointer-events: auto;
    }

    .orkify-panel.orkify-maximized {
      height: calc(100vh - 108px);
      max-height: none;
    }

    .orkify-panel.orkify-maximized .orkify-messages {
      max-height: none;
    }

    /* ── Header ── */
    .orkify-header {
      background: ${primaryColor};
      color: white;
      padding: 16px 20px;
      position: relative;
      z-index: 1;
    }

    .orkify-header::after {
      content: '';
      position: absolute;
      top: 100%;
      left: 0;
      right: 0;
      height: 14px;
      background: linear-gradient(to bottom, rgba(0,0,0,0.18), transparent);
      pointer-events: none;
    }

    .orkify-header-top {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 6px;
      margin-bottom: 2px;
    }

    .orkify-header h3 {
      font-size: 16px;
      font-weight: 600;
      letter-spacing: -0.01em;
    }

    .orkify-header p {
      font-size: 12px;
      opacity: 0.75;
      margin-top: 1px;
    }

    .orkify-presence {
      display: flex;
      align-items: center;
      gap: 10px;
      flex: 1;
      min-width: 0;
    }

    .orkify-presence-avatar-wrap {
      position: relative;
      flex-shrink: 0;
    }

    .orkify-presence-avatar {
      width: 56px;
      height: 56px;
      border-radius: 9999px;
      border: 3px solid white;
      object-fit: cover;
      display: block;
    }

    .orkify-presence-dot {
      width: 12px;
      height: 12px;
      border-radius: 9999px;
      background: #9ca3af;
      position: absolute;
      right: 3px;
      bottom: 3px;
      z-index: 1;
      box-shadow: 0 0 0 2.5px white;
    }

    .orkify-presence-dot.online { background: #22c55e; }
    .orkify-presence-dot.recent { background: #facc15; }

    .orkify-presence-info {
      display: flex;
      flex-direction: column;
      gap: 1px;
      min-width: 0;
    }

    .orkify-presence-name {
      font-size: 15px;
      font-weight: 600;
      letter-spacing: -0.01em;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .orkify-presence-status {
      font-size: 12px;
      opacity: 0.75;
    }

    .orkify-header-actions {
      display: flex;
      gap: 4px;
      flex-shrink: 0;
      margin-left: auto;
    }

    .orkify-close {
      background: rgba(255,255,255,0.12);
      border: none;
      color: white;
      cursor: pointer;
      padding: 5px;
      border-radius: 9999px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s;
      flex-shrink: 0;
    }

    .orkify-close:hover { background: rgba(255,255,255,0.2); }

    /* ── Messages ── */
    .orkify-messages {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      min-height: 260px;
      max-height: 360px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      background: hsl(220 14% 96%);
      position: relative;
    }

    .orkify-messages::-webkit-scrollbar { width: 4px; }
    .orkify-messages::-webkit-scrollbar-track { background: transparent; }
    .orkify-messages::-webkit-scrollbar-thumb {
      background: hsl(220 13% 82%);
      border-radius: 2px;
    }

    /* ── Greeting / empty state ── */
    .orkify-greeting {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 36px 20px;
      flex: 1;
    }

    .orkify-greeting-icon {
      width: 44px;
      height: 44px;
      border-radius: 9999px;
      background: ${primaryColor};
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 14px;
      opacity: 0.9;
    }

    .orkify-greeting-icon svg {
      width: 22px;
      height: 22px;
      fill: white;
    }

    .orkify-greeting-text {
      color: hsl(220 9% 46%);
      font-size: 13px;
      line-height: 1.5;
      max-width: 240px;
    }

    /* ── Message bubbles ── */
    .orkify-msg {
      max-width: 82%;
      padding: 10px 14px;
      border-radius: 12px;
      font-size: 14px;
      line-height: 1.45;
      word-wrap: break-word;
      animation: orkify-fadein 0.2s ease;
    }

    @keyframes orkify-fadein {
      from { opacity: 0; transform: translateY(4px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .orkify-msg-visitor {
      align-self: flex-end;
      background: ${primaryColor};
      color: white;
      border-bottom-right-radius: 4px;
    }

    .orkify-msg-visitor .orkify-msg-time {
      color: rgba(255,255,255,0.65);
    }

    .orkify-msg-support {
      align-self: flex-start;
      display: flex;
      align-items: flex-start;
      gap: 8px;
      background: none;
      padding: 0;
      box-shadow: none;
    }

    .orkify-msg-support .orkify-msg-bubble {
      background: hsl(0 0% 100%);
      color: hsl(224 71% 4%);
      border-radius: 12px;
      border-bottom-left-radius: 4px;
      padding: 10px 14px;
      box-shadow: 0 1px 2px 0 rgba(0,0,0,0.05);
      min-width: 0;
    }

    .orkify-msg-link {
      color: inherit;
      text-decoration: underline;
      text-underline-offset: 2px;
      word-break: break-all;
    }

    .orkify-msg-link:hover { opacity: 0.8; }

    .orkify-msg-visitor .orkify-msg-link { color: white; }

    .orkify-img-wrap {
      position: relative;
      display: inline-block;
      margin-top: 4px;
    }

    .orkify-img-wrap:hover .orkify-img-actions { opacity: 1; }

    .orkify-img-actions {
      position: absolute;
      top: 6px;
      right: 6px;
      display: flex;
      gap: 4px;
      opacity: 0;
      transition: opacity 0.15s;
    }

    .orkify-img-btn {
      width: 28px;
      height: 28px;
      border-radius: 9999px;
      background: rgba(0,0,0,0.55);
      color: white;
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      text-decoration: none;
      transition: background 0.15s;
    }

    .orkify-img-btn:hover { background: rgba(0,0,0,0.75); }

    .orkify-img-btn svg {
      width: 14px;
      height: 14px;
    }

    /* ── Lightbox ── */
    .orkify-lightbox {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.8);
      z-index: 2147483647;
      align-items: center;
      justify-content: center;
      padding: 24px;
      cursor: zoom-out;
    }

    .orkify-lightbox.open { display: flex; }

    .orkify-lightbox-content {
      position: relative;
      max-width: 90vw;
      max-height: 90vh;
    }

    .orkify-lightbox-img {
      max-width: 90vw;
      max-height: 90vh;
      border-radius: 8px;
      object-fit: contain;
      cursor: default;
      display: block;
      box-shadow: 0 20px 60px rgba(0,0,0,0.5);
    }

    .orkify-lightbox-close {
      position: absolute;
      top: -12px;
      right: -12px;
      width: 32px;
      height: 32px;
      border-radius: 9999px;
      background: rgba(0,0,0,0.6);
      color: white;
      border: 1px solid rgba(255,255,255,0.3);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s;
    }

    .orkify-lightbox-close:hover { background: rgba(0,0,0,0.8); }

    .orkify-msg-image {
      max-width: 100%;
      max-height: 200px;
      border-radius: 8px;
      display: block;
      object-fit: contain;
    }

    .orkify-msg-avatar {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      flex-shrink: 0;
      align-self: flex-end;
    }

    .orkify-msg-author {
      font-size: 11px;
      font-weight: 600;
      color: hsl(220 9% 46%);
      margin-bottom: 2px;
    }

    .orkify-msg-time {
      font-size: 11px;
      color: hsl(220 9% 46%);
      margin-top: 3px;
    }

    /* ── Input area ── */
    .orkify-input-area {
      padding: 12px 16px;
      display: flex;
      flex-direction: column;
      gap: 0;
      background: hsl(0 0% 100%);
      position: relative;
    }

    .orkify-input-area::before {
      content: '';
      position: absolute;
      bottom: 100%;
      left: 0;
      right: 0;
      height: 14px;
      background: linear-gradient(to top, rgba(0,0,0,0.12), transparent);
      pointer-events: none;
      z-index: 1;
    }

    .orkify-input-row {
      display: flex;
      flex-direction: column;
      border: 1px solid hsl(220 13% 91%);
      border-radius: 12px;
      background: hsl(0 0% 100%);
      transition: border-color 0.15s, box-shadow 0.15s;
    }

    .orkify-input-row:focus-within {
      border-color: transparent;
      box-shadow: 0 0 0 2px ${primaryColor}80;
    }

    .orkify-input-actions {
      display: flex;
      align-items: center;
      gap: 2px;
      padding: 4px 6px;
    }

    .orkify-input-actions .orkify-send { margin-left: auto; }

    /* ── Emoji picker ── */
    .orkify-emoji-popup {
      display: none;
      flex-direction: column;
      position: absolute;
      bottom: 100%;
      left: 0;
      right: 0;
      margin-bottom: 0;
      background: hsl(0 0% 100%);
      border: 1px solid hsl(220 13% 91%);
      border-radius: 12px 12px 0 0;
      border-bottom: none;
      box-shadow: 0 -4px 12px -2px rgba(0,0,0,0.08);
      overflow: hidden;
      z-index: 1;
    }

    .orkify-emoji-popup.open { display: flex; }

    .orkify-emoji-tabs {
      display: flex;
      border-bottom: 1px solid hsl(220 13% 91%);
      padding: 0 4px;
    }

    .orkify-emoji-tab {
      flex: 1;
      background: none;
      border: none;
      cursor: pointer;
      font-size: 16px;
      padding: 8px 0;
      border-bottom: 2px solid transparent;
      transition: border-color 0.15s, background 0.1s;
      border-radius: 0;
      opacity: 0.5;
    }

    .orkify-emoji-tab:hover { opacity: 0.8; }

    .orkify-emoji-tab.active {
      opacity: 1;
      border-bottom-color: ${primaryColor};
    }

    .orkify-emoji-grid {
      display: grid;
      grid-template-columns: repeat(8, 1fr);
      gap: 2px;
      padding: 8px;
      max-height: 180px;
      overflow-y: auto;
    }

    .orkify-emoji-grid::-webkit-scrollbar { width: 4px; }
    .orkify-emoji-grid::-webkit-scrollbar-track { background: transparent; }
    .orkify-emoji-grid::-webkit-scrollbar-thumb {
      background: hsl(220 13% 82%);
      border-radius: 2px;
    }

    .orkify-emoji-btn {
      background: none;
      border: none;
      cursor: pointer;
      font-size: 20px;
      line-height: 1;
      padding: 5px;
      border-radius: 6px;
      transition: background 0.1s, transform 0.1s;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .orkify-emoji-btn:hover {
      background: hsl(220 14% 93%);
      transform: scale(1.15);
    }

    .orkify-attach-toggle {
      width: 36px;
      height: 36px;
      border-radius: 8px;
      background: none;
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      color: hsl(220 9% 46%);
      transition: color 0.15s, background 0.15s;
    }

    .orkify-attach-toggle:hover {
      color: hsl(220 9% 30%);
      background: hsl(220 14% 96%);
    }

    .orkify-attach-toggle svg {
      width: 20px;
      height: 20px;
    }

    /* ── File preview bar ── */
    .orkify-file-preview {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 10px;
      margin-bottom: 8px;
      background: hsl(220 14% 96%);
      border: 1px solid hsl(220 13% 91%);
      border-radius: 8px;
      font-size: 12px;
      color: hsl(224 71% 4%);
    }

    .orkify-file-preview-thumb {
      width: 36px;
      height: 36px;
      border-radius: 6px;
      object-fit: cover;
      flex-shrink: 0;
    }

    .orkify-file-preview-icon {
      width: 36px;
      height: 36px;
      border-radius: 6px;
      background: hsl(220 13% 86%);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      font-size: 16px;
    }

    .orkify-file-preview-info {
      flex: 1;
      min-width: 0;
    }

    .orkify-file-preview-name {
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .orkify-file-preview-size {
      color: hsl(220 9% 46%);
      font-size: 11px;
    }

    .orkify-file-preview-remove {
      width: 24px;
      height: 24px;
      border-radius: 6px;
      background: none;
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      color: hsl(220 9% 46%);
      transition: color 0.15s, background 0.15s;
    }

    .orkify-file-preview-remove:hover {
      color: hsl(0 72% 51%);
      background: hsl(0 72% 96%);
    }

    .orkify-file-preview-remove svg {
      width: 14px;
      height: 14px;
    }

    /* ── File card (in messages) ── */
    .orkify-file-card {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 10px;
      margin-top: 4px;
      background: rgba(0,0,0,0.06);
      border-radius: 8px;
      text-decoration: none;
      color: inherit;
      font-size: 12px;
      transition: background 0.15s;
    }

    .orkify-file-card:hover { background: rgba(0,0,0,0.1); }

    .orkify-file-card-icon {
      font-size: 18px;
      flex-shrink: 0;
      line-height: 1;
    }

    .orkify-file-card-info {
      flex: 1;
      min-width: 0;
    }

    .orkify-file-card-name {
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .orkify-file-card-size {
      opacity: 0.7;
      font-size: 11px;
    }

    .orkify-msg-visitor .orkify-file-card {
      background: rgba(255,255,255,0.15);
    }

    .orkify-msg-visitor .orkify-file-card:hover { background: rgba(255,255,255,0.25); }

    /* ── Drag overlay ── */
    .orkify-dragover::after {
      content: 'Drop file to attach';
      position: absolute;
      inset: 0;
      background: ${primaryColor}18;
      border: 2px dashed ${primaryColor};
      border-radius: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      font-weight: 500;
      color: ${primaryColor};
      z-index: 10;
      pointer-events: none;
    }

    .orkify-emoji-toggle,
    .orkify-gif-toggle {
      width: 36px;
      height: 36px;
      border-radius: 8px;
      background: none;
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      color: hsl(220 9% 46%);
      transition: color 0.15s, background 0.15s;
    }

    .orkify-emoji-toggle:hover,
    .orkify-gif-toggle:hover {
      color: hsl(220 9% 30%);
      background: hsl(220 14% 96%);
    }

    .orkify-emoji-toggle svg,
    .orkify-gif-toggle svg {
      width: 20px;
      height: 20px;
    }

    /* ── GIF picker ── */
    .orkify-gif-popup {
      display: none;
      flex-direction: column;
      position: absolute;
      bottom: 100%;
      left: 0;
      right: 0;
      margin-bottom: 0;
      background: hsl(0 0% 100%);
      border: 1px solid hsl(220 13% 91%);
      border-radius: 12px 12px 0 0;
      border-bottom: none;
      box-shadow: 0 -4px 12px -2px rgba(0,0,0,0.08);
      overflow: hidden;
      z-index: 1;
    }

    .orkify-gif-popup.open { display: flex; }

    .orkify-gif-search {
      border: none;
      border-bottom: 1px solid hsl(220 13% 91%);
      padding: 10px 12px;
      font-size: 13px;
      font-family: inherit;
      outline: none;
      background: transparent;
      color: hsl(224 71% 4%);
    }

    .orkify-gif-search::placeholder { color: hsl(220 9% 46%); opacity: 1; }

    .orkify-gif-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 4px;
      padding: 6px;
      max-height: 220px;
      overflow-y: auto;
    }

    .orkify-gif-grid::-webkit-scrollbar { width: 4px; }
    .orkify-gif-grid::-webkit-scrollbar-track { background: transparent; }
    .orkify-gif-grid::-webkit-scrollbar-thumb {
      background: hsl(220 13% 82%);
      border-radius: 2px;
    }

    .orkify-gif-item {
      width: 100%;
      height: 100px;
      object-fit: cover;
      border-radius: 6px;
      cursor: pointer;
      transition: opacity 0.1s, transform 0.1s;
    }

    .orkify-gif-item:hover {
      opacity: 0.85;
      transform: scale(1.02);
    }

    .orkify-gif-empty {
      grid-column: 1 / -1;
      text-align: center;
      padding: 24px 12px;
      font-size: 13px;
      color: hsl(220 9% 46%);
    }

    .orkify-gif-attrib {
      text-align: center;
      padding: 4px;
      font-size: 10px;
      color: hsl(220 9% 64%);
      border-top: 1px solid hsl(220 13% 91%);
    }

    .orkify-input {
      width: 100%;
      border: none;
      border-radius: 12px 12px 0 0;
      padding: 12px 14px 8px;
      font-size: 14px;
      font-family: inherit;
      resize: none;
      max-height: 100px;
      min-height: 44px;
      outline: none;
      overflow: hidden;
      background: transparent;
      color: hsl(224 71% 4%);
      line-height: 1.4;
    }

    .orkify-input::placeholder { color: hsl(220 9% 46%); opacity: 1; }

    .orkify-send {
      width: 32px;
      height: 32px;
      border-radius: 9999px;
      background: ${primaryColor};
      color: white;
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: opacity 0.15s, transform 0.15s;
    }

    .orkify-send:hover { opacity: 0.9; transform: scale(1.05); }
    .orkify-send:active { transform: scale(0.95); }
    .orkify-send:disabled { opacity: 0.4; cursor: not-allowed; transform: none; }

    .orkify-send svg {
      width: 16px;
      height: 16px;
      fill: white;
    }

    /* ── Form ── */
    .orkify-form {
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      background: hsl(0 0% 100%);
      border-top: 1px solid hsl(220 13% 91%);
    }

    .orkify-form-title {
      font-size: 14px;
      font-weight: 600;
      color: hsl(224 71% 4%);
    }

    .orkify-form-group {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .orkify-form label {
      font-size: 12px;
      font-weight: 500;
      color: hsl(220 9% 46%);
    }

    .orkify-form input {
      width: 100%;
      border: 1px solid hsl(220 13% 91%);
      border-radius: 8px;
      padding: 8px 12px;
      font-size: 14px;
      font-family: inherit;
      outline: none;
      transition: border-color 0.15s, box-shadow 0.15s;
      background: hsl(220 14% 96%);
      color: hsl(224 71% 4%);
    }

    .orkify-form input:focus {
      border-color: transparent;
      box-shadow: 0 0 0 2px ${primaryColor}80;
      background: hsl(0 0% 100%);
    }

    .orkify-form input::placeholder { color: hsl(220 9% 46%); opacity: 1; }

    .orkify-form-submit {
      background: ${primaryColor};
      color: white;
      border: none;
      border-radius: 8px;
      padding: 10px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 500;
      font-family: inherit;
      transition: opacity 0.15s;
      margin-top: 2px;
    }

    .orkify-form-submit:hover { opacity: 0.9; }

    /* ── Powered by ── */
    .orkify-powered {
      text-align: center;
      padding: 8px 16px;
      font-size: 11px;
      color: hsl(220 9% 46%);
      background: hsl(0 0% 100%);
      border-top: 1px solid hsl(220 14% 96%);
    }

    .orkify-powered a {
      color: hsl(220 9% 36%);
      text-decoration: none;
      font-weight: 500;
    }

    .orkify-powered a:hover { text-decoration: underline; }

    /* ── Mobile ── */
    @media (max-width: 480px) {
      .orkify-panel {
        width: calc(100vw - 16px);
        right: 8px;
        bottom: 84px;
        max-height: calc(100vh - 104px);
      }
      .orkify-launcher {
        bottom: 16px;
        right: 16px;
      }
    }

    /* ── Loading indicator ── */
    .orkify-loading {
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 6px;
      padding: 32px 0;
    }
    .orkify-loading-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: hsl(215 14% 60%);
      animation: orkify-bounce 1.2s infinite ease-in-out;
    }
    .orkify-loading-dot:nth-child(2) { animation-delay: 0.15s; }
    .orkify-loading-dot:nth-child(3) { animation-delay: 0.3s; }
    @keyframes orkify-bounce {
      0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
      40% { opacity: 1; transform: scale(1); }
    }

    /* ── Failed message error state ── */
    .orkify-msg-failed .orkify-msg-visitor,
    .orkify-msg-failed .orkify-msg-bubble {
      opacity: 0.7;
    }
    .orkify-msg-error {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 4px;
      font-size: 0.7rem;
      color: hsl(0 72% 51%);
      padding: 2px 4px 0;
      animation: orkify-fadein 0.15s ease;
    }
    .orkify-msg-error button {
      background: none;
      border: none;
      color: inherit;
      font: inherit;
      text-decoration: underline;
      cursor: pointer;
      padding: 0;
    }

    /* ── Dark mode — matches Orkify design system ── */
    :host(.orkify-dark) { color: hsl(210 20% 98%); }

    /* Primary-foreground: inherit from host page's design system */
    :host(.orkify-dark) .orkify-header { color: var(--color-primary-foreground, hsl(224 71% 4%)); }
    :host(.orkify-dark) .orkify-close { color: var(--color-primary-foreground, hsl(224 71% 4%)); }
    :host(.orkify-dark) .orkify-close:hover { background: rgba(0,0,0,0.1); }
    :host(.orkify-dark) .orkify-msg-visitor { color: var(--color-primary-foreground, hsl(224 71% 4%)); }
    :host(.orkify-dark) .orkify-msg-visitor .orkify-msg-time { color: color-mix(in srgb, var(--color-primary-foreground, hsl(224 71% 4%)) 55%, transparent); }
    :host(.orkify-dark) .orkify-send svg { fill: var(--color-primary-foreground, hsl(224 71% 4%)); }
    :host(.orkify-dark) .orkify-form-submit { color: var(--color-primary-foreground, hsl(224 71% 4%)); }
    :host(.orkify-dark) .orkify-launcher svg { fill: var(--color-primary-foreground, hsl(224 71% 4%)); }

    :host(.orkify-dark) .orkify-panel {
      background: hsl(224 71% 6%);
      box-shadow: 0 40px 80px -20px rgba(0,0,0,0.7), 0 20px 40px -12px rgba(0,0,0,0.5), 0 6px 12px -3px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.07);
    }

    :host(.orkify-dark) .orkify-messages { background: hsl(224 71% 4%); }

    :host(.orkify-dark) .orkify-header::after {
      background: linear-gradient(to bottom, rgba(0,0,0,0.35), transparent);
    }

    :host(.orkify-dark) .orkify-input-area::before {
      background: linear-gradient(to top, rgba(0,0,0,0.3), transparent);
    }

    :host(.orkify-dark) .orkify-msg-support .orkify-msg-bubble {
      background: hsl(215 28% 17%);
      color: hsl(210 20% 98%);
      box-shadow: none;
    }

    :host(.orkify-dark) .orkify-msg-support .orkify-msg-bubble .orkify-msg-time { color: hsl(217 10% 64%); }
    :host(.orkify-dark) .orkify-msg-author { color: hsl(217 10% 64%); }

    :host(.orkify-dark) .orkify-input-area {
      background: hsl(224 71% 6%);
    }

    :host(.orkify-dark) .orkify-input-row {
      border-color: hsl(215 28% 17%);
      background: hsl(224 71% 4%);
    }

    :host(.orkify-dark) .orkify-input-row:focus-within {
      border-color: transparent;
    }

    :host(.orkify-dark) .orkify-emoji-popup {
      background: hsl(224 71% 6%);
      border-color: hsl(215 28% 17%);
      box-shadow: 0 4px 6px -1px rgba(0,0,0,0.3), 0 2px 4px -2px rgba(0,0,0,0.2);
    }

    :host(.orkify-dark) .orkify-emoji-tabs { border-bottom-color: hsl(215 28% 17%); }
    :host(.orkify-dark) .orkify-emoji-grid::-webkit-scrollbar-thumb { background: hsl(215 28% 17%); }
    :host(.orkify-dark) .orkify-emoji-btn:hover { background: hsl(215 28% 17%); }

    :host(.orkify-dark) .orkify-attach-toggle { color: hsl(217 10% 64%); }
    :host(.orkify-dark) .orkify-attach-toggle:hover {
      color: hsl(210 20% 98%);
      background: hsl(215 28% 17%);
    }

    :host(.orkify-dark) .orkify-file-preview {
      background: hsl(224 71% 4%);
      border-color: hsl(215 28% 17%);
      color: hsl(210 20% 98%);
    }

    :host(.orkify-dark) .orkify-file-preview-icon { background: hsl(215 28% 17%); }
    :host(.orkify-dark) .orkify-file-preview-size { color: hsl(217 10% 64%); }
    :host(.orkify-dark) .orkify-file-preview-remove { color: hsl(217 10% 64%); }
    :host(.orkify-dark) .orkify-file-preview-remove:hover {
      color: hsl(0 72% 60%);
      background: hsl(0 72% 15%);
    }

    :host(.orkify-dark) .orkify-file-card { background: rgba(255,255,255,0.08); }
    :host(.orkify-dark) .orkify-file-card:hover { background: rgba(255,255,255,0.12); }
    :host(.orkify-dark) .orkify-msg-visitor .orkify-file-card { background: rgba(0,0,0,0.15); }
    :host(.orkify-dark) .orkify-msg-visitor .orkify-file-card:hover { background: rgba(0,0,0,0.25); }

    :host(.orkify-dark) .orkify-emoji-toggle,
    :host(.orkify-dark) .orkify-gif-toggle { color: hsl(217 10% 64%); }
    :host(.orkify-dark) .orkify-emoji-toggle:hover,
    :host(.orkify-dark) .orkify-gif-toggle:hover {
      color: hsl(210 20% 98%);
      background: hsl(215 28% 17%);
    }

    :host(.orkify-dark) .orkify-gif-popup {
      background: hsl(224 71% 6%);
      border-color: hsl(215 28% 17%);
      box-shadow: 0 4px 6px -1px rgba(0,0,0,0.3), 0 2px 4px -2px rgba(0,0,0,0.2);
    }

    :host(.orkify-dark) .orkify-gif-search {
      border-bottom-color: hsl(215 28% 17%);
      color: hsl(210 20% 98%);
    }

    :host(.orkify-dark) .orkify-gif-search::placeholder { color: hsl(217 10% 64%); }
    :host(.orkify-dark) .orkify-gif-grid::-webkit-scrollbar-thumb { background: hsl(215 28% 17%); }
    :host(.orkify-dark) .orkify-gif-empty { color: hsl(217 10% 64%); }
    :host(.orkify-dark) .orkify-gif-attrib {
      color: hsl(217 10% 50%);
      border-top-color: hsl(215 28% 17%);
    }

    :host(.orkify-dark) .orkify-input {
      color: hsl(210 20% 98%);
    }

    :host(.orkify-dark) .orkify-input::placeholder { color: hsl(217 10% 64%); }

    :host(.orkify-dark) .orkify-messages::-webkit-scrollbar-thumb { background: hsl(215 28% 17%); }

    :host(.orkify-dark) .orkify-greeting-text { color: hsl(217 10% 64%); }

    :host(.orkify-dark) .orkify-form {
      background: hsl(224 71% 6%);
      border-top-color: hsl(215 28% 17%);
    }

    :host(.orkify-dark) .orkify-form-title { color: hsl(210 20% 98%); }
    :host(.orkify-dark) .orkify-form label { color: hsl(217 10% 64%); }

    :host(.orkify-dark) .orkify-form input {
      background: hsl(224 71% 4%);
      border-color: hsl(215 28% 17%);
      color: hsl(210 20% 98%);
    }

    :host(.orkify-dark) .orkify-form input:focus {
      background: hsl(224 71% 6%);
      border-color: transparent;
    }

    :host(.orkify-dark) .orkify-powered {
      background: hsl(224 71% 6%);
      border-top-color: hsl(215 28% 17%);
    }

    :host(.orkify-dark) .orkify-powered a { color: hsl(217 10% 64%); }

    :host(.orkify-dark) .orkify-msg-error { color: hsl(0 62% 68%); }

    :host(.orkify-dark) .orkify-launcher {
      box-shadow: 0 20px 40px -10px rgba(0,0,0,0.5), 0 8px 16px -6px rgba(0,0,0,0.4), 0 2px 4px -1px rgba(0,0,0,0.25);
    }

    :host(.orkify-dark) .orkify-launcher:hover {
      box-shadow: 0 25px 50px -12px rgba(0,0,0,0.6), 0 12px 24px -8px rgba(0,0,0,0.45), 0 4px 8px -2px rgba(0,0,0,0.3);
    }
  `;
}
