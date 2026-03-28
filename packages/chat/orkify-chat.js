"use strict";(()=>{function Te(c){return`
    :host {
      all: initial;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      font-size: 14px;
      line-height: 1.5;
      color: hsl(224 71% 4%);
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    /* \u2500\u2500 Launcher \u2500\u2500 */
    .orkify-launcher {
      position: fixed;
      bottom: 20px;
      right: 20px;
      width: 56px;
      height: 56px;
      border-radius: 9999px;
      background: ${c};
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

    /* \u2500\u2500 Panel \u2500\u2500 */
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

    /* \u2500\u2500 Header \u2500\u2500 */
    .orkify-header {
      background: ${c};
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

    /* \u2500\u2500 Messages \u2500\u2500 */
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

    /* \u2500\u2500 Greeting / empty state \u2500\u2500 */
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
      background: ${c};
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

    /* \u2500\u2500 Message bubbles \u2500\u2500 */
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
      background: ${c};
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

    /* \u2500\u2500 Lightbox \u2500\u2500 */
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

    /* \u2500\u2500 Input area \u2500\u2500 */
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
      box-shadow: 0 0 0 2px ${c}80;
    }

    .orkify-input-actions {
      display: flex;
      align-items: center;
      gap: 2px;
      padding: 4px 6px;
    }

    .orkify-input-actions .orkify-send { margin-left: auto; }

    /* \u2500\u2500 Emoji picker \u2500\u2500 */
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
      border-bottom-color: ${c};
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

    /* \u2500\u2500 File preview bar \u2500\u2500 */
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

    /* \u2500\u2500 File card (in messages) \u2500\u2500 */
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

    /* \u2500\u2500 Drag overlay \u2500\u2500 */
    .orkify-dragover::after {
      content: 'Drop file to attach';
      position: absolute;
      inset: 0;
      background: ${c}18;
      border: 2px dashed ${c};
      border-radius: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      font-weight: 500;
      color: ${c};
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

    /* \u2500\u2500 GIF picker \u2500\u2500 */
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
      background: ${c};
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

    /* \u2500\u2500 Form \u2500\u2500 */
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
      box-shadow: 0 0 0 2px ${c}80;
      background: hsl(0 0% 100%);
    }

    .orkify-form input::placeholder { color: hsl(220 9% 46%); opacity: 1; }

    .orkify-form-submit {
      background: ${c};
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

    /* \u2500\u2500 Powered by \u2500\u2500 */
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

    /* \u2500\u2500 Mobile \u2500\u2500 */
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

    /* \u2500\u2500 Loading indicator \u2500\u2500 */
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

    /* \u2500\u2500 Failed message error state \u2500\u2500 */
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

    /* \u2500\u2500 Dark mode \u2014 matches Orkify design system \u2500\u2500 */
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
  `}var Me="orkify_chat_",Je='<svg class="orkify-icon-chat" viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4V4c0-1.1-.9-2-2-2zm0 15.17L18.83 16H4V4h16v13.17z"/></svg>',Ye='<svg class="orkify-icon-close" viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>',Xe='<svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>',Ze='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>',Qe='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="3"/><text x="12" y="15" text-anchor="middle" font-size="8" font-weight="700" fill="currentColor" stroke="none">GIF</text></svg>',et='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>',tt=8*1024*1024,ze=new Set(["image/png","image/jpeg","image/gif","image/webp","image/svg+xml","application/pdf","text/plain","text/csv","application/zip"]),fe=null;function ot(){return fe||(fe=new Promise((c,k)=>{let U=document.createElement("script");U.src="https://cdnjs.cloudflare.com/ajax/libs/lottie-web/5.12.2/lottie.min.js",U.onload=()=>c(window.lottie),U.onerror=()=>k(new Error("Failed to load lottie-web")),document.head.appendChild(U)})),fe}function $e(c){return c===0?"":c<1024?`${c} B`:c<1024*1024?`${(c/1024).toFixed(1)} KB`:`${(c/(1024*1024)).toFixed(1)} MB`}function He(c){return c.startsWith("image/")?"\u{1F5BC}":c==="application/pdf"?"\u{1F4C4}":c.startsWith("text/")?"\u{1F4DD}":c==="application/zip"?"\u{1F4E6}":"\u{1F4CE}"}var _e=[{icon:"\u{1F600}",emojis:["\u{1F600}","\u{1F603}","\u{1F604}","\u{1F601}","\u{1F606}","\u{1F605}","\u{1F923}","\u{1F602}","\u{1F642}","\u{1F60A}","\u{1F607}","\u{1F970}","\u{1F60D}","\u{1F929}","\u{1F618}","\u{1F60B}","\u{1F61B}","\u{1F914}","\u{1F92B}","\u{1F92D}","\u{1F60F}","\u{1F60C}","\u{1F634}","\u{1F92F}","\u{1F60E}","\u{1F978}","\u{1F624}","\u{1F979}","\u{1F622}","\u{1F62D}","\u{1F631}","\u{1F97A}"]},{icon:"\u{1F44B}",emojis:["\u{1F44B}","\u{1F91A}","\u{1F590}\uFE0F","\u270B","\u{1F44C}","\u{1F90C}","\u270C\uFE0F","\u{1F91E}","\u{1F91F}","\u{1F918}","\u{1F919}","\u{1F44D}","\u{1F44E}","\u270A","\u{1F44A}","\u{1F44F}","\u{1F64C}","\u{1FAF6}","\u{1F450}","\u{1F91D}","\u{1F64F}","\u{1F4AA}","\u{1FAE1}","\u{1F448}","\u{1F449}","\u{1F446}","\u{1F447}","\u261D\uFE0F","\u{1F440}","\u{1F9E0}","\u{1F480}","\u{1FAF5}"]},{icon:"\u2764\uFE0F",emojis:["\u2764\uFE0F","\u{1F9E1}","\u{1F49B}","\u{1F49A}","\u{1F499}","\u{1F49C}","\u{1F5A4}","\u{1F90D}","\u{1F90E}","\u{1F494}","\u2764\uFE0F\u200D\u{1F525}","\u2764\uFE0F\u200D\u{1FA79}","\u{1F495}","\u{1F49E}","\u{1F493}","\u{1F497}","\u{1F496}","\u{1F498}","\u{1F49D}","\u{1F49F}","\u{1F48B}","\u{1F48C}","\u{1F490}","\u{1F339}","\u{1F940}","\u{1F338}","\u{1F33A}","\u{1F33B}","\u{1F33C}","\u{1F337}","\u{1F4AE}","\u2665\uFE0F"]},{icon:"\u{1F389}",emojis:["\u{1F389}","\u{1F38A}","\u{1F388}","\u{1F381}","\u{1F380}","\u{1F3C6}","\u{1F947}","\u{1F948}","\u{1F949}","\u26BD","\u{1F3C0}","\u{1F3AE}","\u{1F3AF}","\u{1F3B2}","\u{1F3AD}","\u{1F3A8}","\u{1F3AC}","\u{1F3A4}","\u{1F3A7}","\u{1F3B5}","\u{1F3B6}","\u{1F3B9}","\u{1F3B8}","\u{1F941}","\u{1F3BA}","\u{1F3BB}","\u{1F3AA}","\u{1F39F}\uFE0F","\u{1F3B0}","\u{1F3B3}","\u{1F3C5}","\u{1F397}\uFE0F"]},{icon:"\u{1F680}",emojis:["\u{1F680}","\u2708\uFE0F","\u{1F697}","\u{1F695}","\u{1F3CE}\uFE0F","\u{1F693}","\u{1F691}","\u{1F692}","\u{1F6F8}","\u26F5","\u{1F6A2}","\u23F0","\u{1F514}","\u{1F4F1}","\u{1F4BB}","\u{1F5A5}\uFE0F","\u{1F4F8}","\u{1F4A1}","\u{1F50B}","\u{1F50C}","\u{1F4E6}","\u{1F4DD}","\u{1F4CE}","\u2702\uFE0F","\u{1F4CC}","\u{1F511}","\u{1F512}","\u{1F513}","\u{1F6E0}\uFE0F","\u2699\uFE0F","\u{1F9F2}","\u{1F52D}"]},{icon:"\u2728",emojis:["\u2728","\u2B50","\u{1F31F}","\u{1F4AB}","\u26A1","\u{1F525}","\u{1F4A5}","\u{1F308}","\u2600\uFE0F","\u{1F327}\uFE0F","\u2744\uFE0F","\u{1F4A7}","\u{1F30A}","\u{1F30D}","\u{1F315}","\u{1F319}","\u2705","\u274C","\u2753","\u2757","\u{1F4AF}","\u2B55","\u{1F534}","\u{1F7E2}","\u{1F535}","\u26AA","\u26AB","\u{1F6A9}","\u{1F3F3}\uFE0F","\u{1F3F4}","\u{1F195}","\u{1F197}"]}];(function(){let c=document.currentScript;if(c||(c=document.querySelector("script[data-widget-key]")),!c)return;let k=c.getAttribute("data-widget-key");if(!k)return;let U=c;me();function me(Fe=!1){let J=U,he=window.__orkify_visitor,ne=he,Oe=J.getAttribute("data-visitor-name")||ne?.name||"",B=J.getAttribute("data-visitor-email")||ne?.email||"",ge=J.getAttribute("data-visitor-hash")||ne?.hash||"",re=J.getAttribute("data-klipy-key")||"",T=new URL(J.src).origin,x=B?`${Me}${k}_${B}`:`${Me}${k}`;he===null&&!B&&(localStorage.removeItem(`${x}_thread`),localStorage.removeItem(`${x}_name`),localStorage.removeItem(`${x}_email`));let F=null,h=localStorage.getItem(`${x}_thread`),I=Oe||localStorage.getItem(`${x}_name`)||"",R=B||localStorage.getItem(`${x}_email`)||"",C=null,Y=1e3,Be=3e4,M=null,A=!1,b=!1,D=null,v=null,z=null,N=null,ae=null,$,y,w,X=document.createElement("div");X.id="orkify-chat-widget",document.body.appendChild(X);let Z=X.attachShadow({mode:"closed"});function se(){let e=document.documentElement.style.colorScheme,t;e?t=e==="dark":document.documentElement.classList.contains("dark")?t=!0:document.documentElement.dataset.theme?t=document.documentElement.dataset.theme==="dark":t=window.matchMedia("(prefers-color-scheme: dark)").matches,X.classList.toggle("orkify-dark",t)}se();let ue=new MutationObserver(se);ue.observe(document.documentElement,{attributes:!0,attributeFilter:["class","style","data-theme"]}),window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change",se);let L=null,le=!1;function Re(e){let t=Math.max(0,Math.floor((Date.now()-e)/1e3));return t<60?"Active now":t<3600?`Active ${Math.floor(t/60)}m ago`:t<86400?`Active ${Math.floor(t/3600)}h ago`:`Active ${Math.floor(t/86400)}d ago`}function Ae(e){if(!e.isBot||!e.avatar)return;let t=new Date(e.timestamp).getTime();z&&t<z.timestamp||(z={name:e.author,avatar:e.avatar,timestamp:t},ke())}function ke(){if(!N||!z)return;let e=Date.now()-z.timestamp,t=e<300*1e3,r=e<3600*1e3;N.innerHTML="",N.style.display="flex";let o=N.parentElement;if(o){let g=o.querySelector("h3");g&&(g.style.display="none");let j=o.parentElement?.querySelector(".orkify-subtitle");j&&(j.style.display="none")}let s=document.createElement("div");s.className="orkify-presence-avatar-wrap";let i=document.createElement("img");i.className="orkify-presence-avatar",i.src=z.avatar,i.alt="",s.appendChild(i);let a=document.createElement("span");a.className=`orkify-presence-dot${t?" online":r?" recent":""}`,s.appendChild(a),N.appendChild(s);let l=document.createElement("div");l.className="orkify-presence-info";let f=document.createElement("div");f.className="orkify-presence-name",f.textContent=z.name,l.appendChild(f);let p=document.createElement("div");p.className="orkify-presence-status",p.textContent=Re(z.timestamp),l.appendChild(p),N.appendChild(l)}async function De(){try{let e=await fetch(`${T}/api/chat/config?widgetKey=${k}`);if(!e.ok||(F=await e.json(),!F))return;let t=`${x}_thread_lookup`;if(B&&ge&&!h&&!sessionStorage.getItem(t)){try{let r=await fetch(`${T}/api/chat/thread?widgetKey=${k}&visitorEmail=${encodeURIComponent(B)}&visitorHash=${encodeURIComponent(ge)}`);if(r.ok){let o=await r.json();o.threadId&&(h=o.threadId,localStorage.setItem(`${x}_thread`,o.threadId))}}catch{}sessionStorage.setItem(t,"1")}Pe()}catch(e){console.error("[Orkify Chat] Init failed:",e)}}function ye(){le||!h||(le=!0,We().catch(()=>{le=!1}),P())}function Pe(){if(!F)return;let e=document.createElement("style");e.textContent=Te(F.color),Z.appendChild(e),$=document.createElement("button"),$.className="orkify-launcher",$.innerHTML=Je+Ye+'<span class="orkify-unread"></span>',$.addEventListener("click",ve),Z.appendChild($),y=document.createElement("div"),y.className="orkify-panel";let t=document.createElement("div");t.className="orkify-header";let r=document.createElement("div");r.className="orkify-header-top";let o=document.createElement("h3");o.textContent=F.title;let s=document.createElement("button");s.className="orkify-close",s.title="Maximize";let i='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>',a='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>';s.innerHTML=i,s.addEventListener("click",()=>{let m=y.classList.toggle("orkify-maximized");s.innerHTML=m?a:i,s.title=m?"Restore":"Maximize"});let l=document.createElement("button");l.className="orkify-close",l.title="Close",l.innerHTML='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>',l.addEventListener("click",ve),N=document.createElement("div"),N.className="orkify-presence",N.style.display="none";let f=document.createElement("div");f.className="orkify-header-actions",f.appendChild(s),f.appendChild(l),r.appendChild(o),r.appendChild(N),r.appendChild(f),t.appendChild(r);let p=document.createElement("p");if(p.className="orkify-subtitle",p.textContent="We typically reply within a few minutes",t.appendChild(p),ae=setInterval(()=>{z&&ke()},3e4),y.appendChild(t),w=document.createElement("div"),w.className="orkify-messages",!h)Ge();else{let m=document.createElement("div");m.className="orkify-loading",m.innerHTML='<span class="orkify-loading-dot"></span><span class="orkify-loading-dot"></span><span class="orkify-loading-dot"></span>',w.appendChild(m)}y.appendChild(w),I&&R?be():Ke();let g=document.createElement("div");g.className="orkify-powered",g.innerHTML='Powered by <a href="https://orkify.com" target="_blank" rel="noopener">orkify</a>',y.appendChild(g),L=document.createElement("div"),L.className="orkify-lightbox",L.addEventListener("click",m=>{m.target===L&&de()});let S=document.createElement("div");S.className="orkify-lightbox-content";let j=document.createElement("img");j.className="orkify-lightbox-img",j.alt="",S.appendChild(j);let E=document.createElement("button");E.className="orkify-lightbox-close",E.type="button",E.innerHTML='<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>',E.addEventListener("click",de),S.appendChild(E),L.appendChild(S),Z.appendChild(y),Z.appendChild(L),Fe&&(A=!0,y.classList.add("open"),$.classList.add("open"),ye())}function Ue(e){if(!L)return;let t=L.querySelector(".orkify-lightbox-img");t.src=e,L.classList.add("open"),window.addEventListener("keydown",xe)}function de(){if(!L)return;L.classList.remove("open");let e=L.querySelector(".orkify-lightbox-img");e.src="",window.removeEventListener("keydown",xe)}function xe(e){e.key==="Escape"&&de()}function Ge(){if(!F)return;let e=document.createElement("div");e.className="orkify-greeting";let t=document.createElement("div");t.className="orkify-greeting-icon",t.innerHTML='<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4V4c0-1.1-.9-2-2-2z"/></svg>',e.appendChild(t);let r=document.createElement("div");r.className="orkify-greeting-text",r.textContent=F.greeting,e.appendChild(r),w.appendChild(e)}function Ke(){if(!F)return;let e=document.createElement("div");e.className="orkify-form";let t=document.createElement("div");t.className="orkify-form-title",t.textContent="Start a conversation",e.appendChild(t);let r=document.createElement("div");r.className="orkify-form-group";let o=document.createElement("label");o.textContent="Name";let s=document.createElement("input");s.type="text",s.placeholder="Your name",r.appendChild(o),r.appendChild(s);let i=document.createElement("div");i.className="orkify-form-group";let a=document.createElement("label");a.textContent="Email";let l=document.createElement("input");l.type="email",l.placeholder="you@example.com",i.appendChild(a),i.appendChild(l);let f=document.createElement("button");f.className="orkify-form-submit",f.textContent="Start chat",f.addEventListener("click",()=>{let p=s.value.trim(),g=l.value.trim();!p||!g||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(g)||(I=p,R=g,localStorage.setItem(`${x}_name`,p),localStorage.setItem(`${x}_email`,g),e.remove(),be())}),e.appendChild(r),e.appendChild(i),e.appendChild(f),y.insertBefore(e,y.querySelector(".orkify-powered"))}function be(){let e=document.createElement("div");e.className="orkify-input-area";let t=document.createElement("div");t.className="orkify-emoji-popup";let r=document.createElement("div");r.className="orkify-emoji-tabs";let o=document.createElement("div");o.className="orkify-emoji-grid";function s(n){o.innerHTML="";for(let d of _e[n].emojis){let u=document.createElement("button");u.className="orkify-emoji-btn",u.textContent=d,u.type="button",u.addEventListener("click",()=>{m.value+=d,m.focus(),m.dispatchEvent(new Event("input")),t.classList.remove("open")}),o.appendChild(u)}r.querySelectorAll(".orkify-emoji-tab").forEach((d,u)=>{d.classList.toggle("active",u===n)})}_e.forEach((n,d)=>{let u=document.createElement("button");u.className="orkify-emoji-tab",u.textContent=n.icon,u.type="button",u.addEventListener("click",()=>s(d)),r.appendChild(u)}),t.appendChild(r),t.appendChild(o),s(0);let i=document.createElement("div");i.className="orkify-gif-popup";let a=document.createElement("input");a.className="orkify-gif-search",a.type="text",a.placeholder="Search GIFs...";let l=document.createElement("div");l.className="orkify-gif-grid";let f=document.createElement("div");f.className="orkify-gif-attrib",f.textContent="Powered by Klipy",i.appendChild(a),i.appendChild(l),i.appendChild(f);let p={trending:null,searches:{}},g=null;function S(n){if(l.innerHTML="",n.length===0){let d=document.createElement("div");d.className="orkify-gif-empty",d.textContent="No GIFs found",l.appendChild(d);return}for(let d of n){let u=document.createElement("img");u.className="orkify-gif-item",u.src=d.preview,u.alt="GIF",u.loading="lazy",u.addEventListener("click",()=>{i.classList.remove("open"),we(d.url)}),l.appendChild(u)}}async function j(n){if(!re){l.innerHTML='<div class="orkify-gif-empty">GIF search not configured</div>';return}let d=n||"__trending__";if(d==="__trending__"&&p.trending){S(p.trending);return}if(p.searches[d]){S(p.searches[d]);return}l.innerHTML='<div class="orkify-gif-empty">Loading...</div>';try{let u=n?"search":"trending",W=new URLSearchParams({per_page:"20",page:"1",customer_id:"orkify_widget",content_filter:"medium"});n&&W.set("q",n);let O=await fetch(`https://api.klipy.com/api/v1/${re}/gifs/${u}?${W}`);if(!O.ok)return;let pe=((await O.json())?.data?.data??[]).map(Se=>{let V=Se.file;return{id:String(Se.id),url:V?.hd?.gif?.url??V?.md?.gif?.url??"",preview:V?.sm?.gif?.url??V?.xs?.gif?.url??"",width:V?.sm?.gif?.width??220,height:V?.sm?.gif?.height??220}});n?p.searches[d]=pe:p.trending=pe,S(pe)}catch{l.innerHTML='<div class="orkify-gif-empty">Failed to load GIFs</div>'}}a.addEventListener("input",()=>{g&&clearTimeout(g),g=setTimeout(()=>j(a.value.trim()),300)});let E=document.createElement("div");E.className="orkify-input-row";let m=document.createElement("textarea");m.className="orkify-input",m.placeholder="Write a message...",m.rows=1,m.addEventListener("keydown",n=>{n.key==="Enter"&&!n.shiftKey&&(n.preventDefault(),D?je(D):Ce(m))}),m.addEventListener("input",()=>{m.style.height="auto",m.style.height=Math.min(m.scrollHeight,80)+"px"});let G=document.createElement("button");G.className="orkify-emoji-toggle",G.innerHTML=Ze,G.type="button",G.addEventListener("click",n=>{n.stopPropagation(),i.classList.remove("open"),t.classList.toggle("open")});let K=document.createElement("button");K.className="orkify-gif-toggle",K.innerHTML=Qe,K.type="button",K.addEventListener("click",n=>{n.stopPropagation(),t.classList.remove("open");let d=!i.classList.contains("open");i.classList.toggle("open"),d&&j(a.value.trim())}),Z.addEventListener("click",n=>{let d=n.target;!t.contains(d)&&d!==G&&t.classList.remove("open"),!i.contains(d)&&d!==K&&i.classList.remove("open")});let H=document.createElement("input");H.type="file",H.style.display="none",H.accept=Array.from(ze).join(","),H.addEventListener("change",()=>{H.files?.[0]&&Ie(H.files[0]),H.value=""});let te=document.createElement("button");te.className="orkify-attach-toggle",te.innerHTML=et,te.type="button",te.addEventListener("click",n=>{n.stopPropagation(),t.classList.remove("open"),i.classList.remove("open"),H.click()});function Ie(n){if(!ze.has(n.type)){alert("File type not supported");return}if(n.size>tt){alert("File too large (max 8 MB)");return}D=n,Ve(n)}function Ve(n){if(Ne(),v=document.createElement("div"),v.className="orkify-file-preview",n.type.startsWith("image/")){let _=document.createElement("img");_.className="orkify-file-preview-thumb",_.src=URL.createObjectURL(n),_.alt="",v.appendChild(_)}else{let _=document.createElement("div");_.className="orkify-file-preview-icon",_.textContent=He(n.type),v.appendChild(_)}let d=document.createElement("div");d.className="orkify-file-preview-info";let u=document.createElement("div");u.className="orkify-file-preview-name",u.textContent=n.name,d.appendChild(u);let W=document.createElement("div");W.className="orkify-file-preview-size",W.textContent=$e(n.size),d.appendChild(W),v.appendChild(d);let O=document.createElement("button");O.className="orkify-file-preview-remove",O.type="button",O.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>',O.addEventListener("click",()=>{D=null,Ne()}),v.appendChild(O),e.insertBefore(v,E)}function Ne(){if(v){let n=v.querySelector(".orkify-file-preview-thumb");n&&URL.revokeObjectURL(n.src),v.remove(),v=null}}let oe=0;y.addEventListener("dragenter",n=>{n.preventDefault(),oe++,y.classList.add("orkify-dragover")}),y.addEventListener("dragleave",()=>{oe--,oe<=0&&(oe=0,y.classList.remove("orkify-dragover"))}),y.addEventListener("dragover",n=>{n.preventDefault()}),y.addEventListener("drop",n=>{n.preventDefault(),oe=0,y.classList.remove("orkify-dragover");let d=n.dataTransfer?.files[0];d&&Ie(d)});let ie=document.createElement("button");ie.className="orkify-send",ie.innerHTML=Xe,ie.addEventListener("click",()=>{D?je(D):Ce(m)});let q=document.createElement("div");q.className="orkify-input-actions",q.appendChild(te),q.appendChild(G),re&&q.appendChild(K),q.appendChild(ie),E.appendChild(m),E.appendChild(q),e.appendChild(H),e.appendChild(t),re&&e.appendChild(i),e.appendChild(E),y.insertBefore(e,y.querySelector(".orkify-powered"))}function ce(){requestAnimationFrame(()=>{requestAnimationFrame(()=>{w.scrollTop=w.scrollHeight})})}function ve(){if((window.__orkify_visitor?.email||"")!==B){C&&C.close(),M&&clearTimeout(M),X.remove(),me(!0);return}A=!A,y.classList.toggle("open",A),$.classList.toggle("open",A),A&&($.classList.remove("orkify-has-unread"),ye(),ce())}function Q(e){Ae(e),!A&&e.isBot&&$.classList.add("orkify-has-unread");let t=w.querySelector(".orkify-greeting");t&&t.remove();let r=document.createElement("div");r.className=`orkify-msg ${e.isBot?"orkify-msg-support":"orkify-msg-visitor"}`;let o=r;if(e.isBot){if(e.avatar){let a=document.createElement("img");a.className="orkify-msg-avatar",a.src=e.avatar,a.alt="",r.appendChild(a)}o=document.createElement("div"),o.className="orkify-msg-bubble";let i=document.createElement("div");i.className="orkify-msg-author",i.textContent=e.author,o.appendChild(i),r.appendChild(o)}if(e.content){let i=document.createElement("div");i.textContent=e.content,o.appendChild(i)}if(e.attachments)for(let i of e.attachments)if(i.contentType==="application/json+lottie"){let a=document.createElement("div");a.className="orkify-msg-image orkify-lottie",a.style.width="200px",a.style.height="200px",o.appendChild(a),ot().then(l=>{let f=i.url.split(",")[1],p=JSON.parse(atob(f));l.loadAnimation({container:a,renderer:"svg",loop:!0,autoplay:!0,animationData:p})}).catch(()=>{a.textContent="(sticker)"})}else if(i.contentType.startsWith("image/")){let a=document.createElement("div");a.className="orkify-img-wrap";let l=document.createElement("img");l.className="orkify-msg-image",l.src=i.url,l.alt=i.filename,l.loading="lazy",l.addEventListener("load",ce),a.appendChild(l);let f=document.createElement("div");f.className="orkify-img-actions";let p=document.createElement("button");p.className="orkify-img-btn",p.type="button",p.title="View full size",p.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>',p.addEventListener("click",()=>Ue(i.url));let g=document.createElement("button");g.className="orkify-img-btn",g.type="button",g.title="Download",g.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',g.addEventListener("click",async()=>{try{let j=await(await fetch(i.url)).blob(),E=URL.createObjectURL(j),m=document.createElement("a");m.href=E,m.download=i.filename,m.click(),URL.revokeObjectURL(E)}catch{window.open(i.url,"_blank")}}),f.appendChild(p),f.appendChild(g),a.appendChild(f),o.appendChild(a)}else{let a=document.createElement("a");a.className="orkify-file-card",a.href=i.url,a.target="_blank",a.rel="noopener";let l=document.createElement("span");l.className="orkify-file-card-icon",l.textContent=He(i.contentType),a.appendChild(l);let f=document.createElement("div");f.className="orkify-file-card-info";let p=document.createElement("div");if(p.className="orkify-file-card-name",p.textContent=i.filename,f.appendChild(p),i.size>0){let g=document.createElement("div");g.className="orkify-file-card-size",g.textContent=$e(i.size),f.appendChild(g)}a.appendChild(f),o.appendChild(a)}let s=document.createElement("div");return s.className="orkify-msg-time",s.textContent=new Date(e.timestamp).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}),o.appendChild(s),w.appendChild(r),w.scrollTop=w.scrollHeight,r}function qe(e){e.classList.remove("orkify-msg-failed");let t=e.querySelector(".orkify-msg-error");t&&t.remove()}function ee(e,t){if(e.classList.add("orkify-msg-failed"),e.querySelector(".orkify-msg-error"))return;let r=document.createElement("div");r.className="orkify-msg-error",r.textContent="\u26A0 Failed to send \xB7 ";let o=document.createElement("button");o.type="button",o.textContent="Tap to retry",o.addEventListener("click",()=>{qe(e),t()}),r.appendChild(o),e.appendChild(r),w.scrollTop=w.scrollHeight}async function we(e){if(b)return;b=!0;let t=Q({content:"",attachments:[{url:e,filename:"gif",contentType:"image/gif",size:0}],author:I,timestamp:new Date().toISOString(),isBot:!1});try{let r=await fetch(`${T}/api/chat/send?widgetKey=${k}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({widgetKey:k,message:e,threadId:h,visitorName:I,visitorEmail:R})});if(!r.ok)throw new Error("Send failed");let o=await r.json();o.threadId&&o.threadId!==h&&(h=o.threadId,localStorage.setItem(`${x}_thread`,o.threadId),P())}catch(r){console.error("[Orkify Chat] Send GIF error:",r),ee(t,()=>we(e))}finally{b=!1}}async function Ee(e,t){if(!b){b=!0;try{let r=await fetch(`${T}/api/chat/send?widgetKey=${k}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({widgetKey:k,message:e,threadId:h,visitorName:I,visitorEmail:R})});if(!r.ok)throw new Error("Send failed");let o=await r.json();o.threadId&&o.threadId!==h&&(h=o.threadId,localStorage.setItem(`${x}_thread`,o.threadId),P())}catch(r){console.error("[Orkify Chat] Send error:",r),ee(t,()=>Ee(e,t))}finally{b=!1}}}async function Ce(e){let t=e.value.trim();if(!t||b)return;b=!0,e.value="",e.style.height="auto";let r=Q({content:t,author:I,timestamp:new Date().toISOString(),isBot:!1});try{let o=await fetch(`${T}/api/chat/send?widgetKey=${k}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({widgetKey:k,message:t,threadId:h,visitorName:I,visitorEmail:R})});if(!o.ok)throw new Error("Send failed");let s=await o.json();s.threadId&&s.threadId!==h&&(h=s.threadId,localStorage.setItem(`${x}_thread`,s.threadId),P())}catch(o){console.error("[Orkify Chat] Send error:",o),ee(r,()=>Ee(t,r))}finally{b=!1}}async function Le(e,t){if(!b){b=!0;try{let r=new FormData;r.append("file",e),k&&r.append("widgetKey",k),r.append("visitorName",I),r.append("visitorEmail",R),h&&r.append("threadId",h);let o=await fetch(`${T}/api/chat/upload?widgetKey=${k}`,{method:"POST",body:r});if(!o.ok)throw new Error("Upload failed");let s=await o.json();s.threadId&&s.threadId!==h&&(h=s.threadId,localStorage.setItem(`${x}_thread`,s.threadId),P())}catch(r){console.error("[Orkify Chat] Upload error:",r),ee(t,()=>Le(e,t))}finally{b=!1}}}async function je(e){if(b)return;b=!0;let t=e.type.startsWith("image/")?URL.createObjectURL(e):"",r=Q({content:"",attachments:[{url:t,filename:e.name,contentType:e.type,size:e.size}],author:I,timestamp:new Date().toISOString(),isBot:!1});if(D=null,v){let o=v.querySelector(".orkify-file-preview-thumb");o&&URL.revokeObjectURL(o.src),v.remove(),v=null}try{let o=new FormData;o.append("file",e),k&&o.append("widgetKey",k),o.append("visitorName",I),o.append("visitorEmail",R),h&&o.append("threadId",h);let s=await fetch(`${T}/api/chat/upload?widgetKey=${k}`,{method:"POST",body:o});if(!s.ok)throw new Error("Upload failed");let i=await s.json();i.threadId&&i.threadId!==h&&(h=i.threadId,localStorage.setItem(`${x}_thread`,i.threadId),P())}catch(o){console.error("[Orkify Chat] Upload error:",o),ee(r,()=>Le(e,r))}finally{b=!1,t&&URL.revokeObjectURL(t)}}function P(){h&&(C&&C.close(),M&&(clearTimeout(M),M=null),C=new EventSource(`${T}/api/chat/stream?widgetKey=${k}&threadId=${h}`),C.onopen=()=>{Y=1e3},C.onmessage=e=>{try{let t=JSON.parse(e.data);t.type==="message"&&Q(t)}catch{}},C.onerror=()=>{C&&(C.close(),C=null),console.warn(`[Orkify Chat] SSE error, reconnecting in ${Y/1e3}s`),M=setTimeout(()=>{M=null,P()},Y),Y=Math.min(Y*2,Be)})}async function We(){if(h)try{let e=await fetch(`${T}/api/chat/history?widgetKey=${k}&threadId=${h}`);if(!e.ok){e.status===404&&(h=null,localStorage.removeItem(`${x}_thread`));return}let t=await e.json(),r=w.querySelector(".orkify-loading");if(r&&r.remove(),t.messages){for(let o of t.messages)Q(o);ce()}}catch(e){throw console.error("[Orkify Chat] History error:",e),e}}window.addEventListener("beforeunload",()=>{C&&C.close(),M&&clearTimeout(M),ae&&clearInterval(ae),ue.disconnect()}),De()}})();})();
