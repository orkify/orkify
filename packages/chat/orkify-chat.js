"use strict";(()=>{var Xe="https://orkify.com",Ze=["cdn.jsdelivr.net","jsdelivr.net","unpkg.com","cdnjs.cloudflare.com","esm.sh","esm.run","skypack.dev","statically.io","jspm.io"];function Te(s){if(!s)return null;try{let f=new URL(s);return f.protocol!=="https:"&&f.protocol!=="http:"?null:f.origin}catch{return null}}function Qe(s){let f=new URL(s).hostname.toLowerCase();return Ze.some(L=>f===L||f.endsWith(`.${L}`))}function Me(s,f){let L=Te(f);if(L)return L;let G=Te(s);return G&&!Qe(G)?G:Xe}function ze(s){return`
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
      background: ${s};
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
      background: ${s};
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
      background: ${s};
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
      background: ${s};
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
      box-shadow: 0 0 0 2px ${s}80;
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
      border-bottom-color: ${s};
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
      background: ${s}18;
      border: 2px dashed ${s};
      border-radius: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      font-weight: 500;
      color: ${s};
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
      background: ${s};
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
      box-shadow: 0 0 0 2px ${s}80;
      background: hsl(0 0% 100%);
    }

    .orkify-form input::placeholder { color: hsl(220 9% 46%); opacity: 1; }

    .orkify-form-submit {
      background: ${s};
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
  `}var $e="orkify_chat_",et='<svg class="orkify-icon-chat" viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4V4c0-1.1-.9-2-2-2zm0 15.17L18.83 16H4V4h16v13.17z"/></svg>',tt='<svg class="orkify-icon-close" viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>',ot='<svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>',rt='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>',it='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="3"/><text x="12" y="15" text-anchor="middle" font-size="8" font-weight="700" fill="currentColor" stroke="none">GIF</text></svg>',nt='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>',at=8*1024*1024,He=new Set(["image/png","image/jpeg","image/gif","image/webp","image/svg+xml","application/pdf","text/plain","text/csv","application/zip"]),me=null;function st(){return me||(me=new Promise((s,f)=>{let L=document.createElement("script");L.src="https://cdnjs.cloudflare.com/ajax/libs/lottie-web/5.12.2/lottie.min.js",L.onload=()=>s(window.lottie),L.onerror=()=>f(new Error("Failed to load lottie-web")),document.head.appendChild(L)})),me}function _e(s){return s===0?"":s<1024?`${s} B`:s<1024*1024?`${(s/1024).toFixed(1)} KB`:`${(s/(1024*1024)).toFixed(1)} MB`}function Fe(s){return s.startsWith("image/")?"\u{1F5BC}":s==="application/pdf"?"\u{1F4C4}":s.startsWith("text/")?"\u{1F4DD}":s==="application/zip"?"\u{1F4E6}":"\u{1F4CE}"}var Oe=[{icon:"\u{1F600}",emojis:["\u{1F600}","\u{1F603}","\u{1F604}","\u{1F601}","\u{1F606}","\u{1F605}","\u{1F923}","\u{1F602}","\u{1F642}","\u{1F60A}","\u{1F607}","\u{1F970}","\u{1F60D}","\u{1F929}","\u{1F618}","\u{1F60B}","\u{1F61B}","\u{1F914}","\u{1F92B}","\u{1F92D}","\u{1F60F}","\u{1F60C}","\u{1F634}","\u{1F92F}","\u{1F60E}","\u{1F978}","\u{1F624}","\u{1F979}","\u{1F622}","\u{1F62D}","\u{1F631}","\u{1F97A}"]},{icon:"\u{1F44B}",emojis:["\u{1F44B}","\u{1F91A}","\u{1F590}\uFE0F","\u270B","\u{1F44C}","\u{1F90C}","\u270C\uFE0F","\u{1F91E}","\u{1F91F}","\u{1F918}","\u{1F919}","\u{1F44D}","\u{1F44E}","\u270A","\u{1F44A}","\u{1F44F}","\u{1F64C}","\u{1FAF6}","\u{1F450}","\u{1F91D}","\u{1F64F}","\u{1F4AA}","\u{1FAE1}","\u{1F448}","\u{1F449}","\u{1F446}","\u{1F447}","\u261D\uFE0F","\u{1F440}","\u{1F9E0}","\u{1F480}","\u{1FAF5}"]},{icon:"\u2764\uFE0F",emojis:["\u2764\uFE0F","\u{1F9E1}","\u{1F49B}","\u{1F49A}","\u{1F499}","\u{1F49C}","\u{1F5A4}","\u{1F90D}","\u{1F90E}","\u{1F494}","\u2764\uFE0F\u200D\u{1F525}","\u2764\uFE0F\u200D\u{1FA79}","\u{1F495}","\u{1F49E}","\u{1F493}","\u{1F497}","\u{1F496}","\u{1F498}","\u{1F49D}","\u{1F49F}","\u{1F48B}","\u{1F48C}","\u{1F490}","\u{1F339}","\u{1F940}","\u{1F338}","\u{1F33A}","\u{1F33B}","\u{1F33C}","\u{1F337}","\u{1F4AE}","\u2665\uFE0F"]},{icon:"\u{1F389}",emojis:["\u{1F389}","\u{1F38A}","\u{1F388}","\u{1F381}","\u{1F380}","\u{1F3C6}","\u{1F947}","\u{1F948}","\u{1F949}","\u26BD","\u{1F3C0}","\u{1F3AE}","\u{1F3AF}","\u{1F3B2}","\u{1F3AD}","\u{1F3A8}","\u{1F3AC}","\u{1F3A4}","\u{1F3A7}","\u{1F3B5}","\u{1F3B6}","\u{1F3B9}","\u{1F3B8}","\u{1F941}","\u{1F3BA}","\u{1F3BB}","\u{1F3AA}","\u{1F39F}\uFE0F","\u{1F3B0}","\u{1F3B3}","\u{1F3C5}","\u{1F397}\uFE0F"]},{icon:"\u{1F680}",emojis:["\u{1F680}","\u2708\uFE0F","\u{1F697}","\u{1F695}","\u{1F3CE}\uFE0F","\u{1F693}","\u{1F691}","\u{1F692}","\u{1F6F8}","\u26F5","\u{1F6A2}","\u23F0","\u{1F514}","\u{1F4F1}","\u{1F4BB}","\u{1F5A5}\uFE0F","\u{1F4F8}","\u{1F4A1}","\u{1F50B}","\u{1F50C}","\u{1F4E6}","\u{1F4DD}","\u{1F4CE}","\u2702\uFE0F","\u{1F4CC}","\u{1F511}","\u{1F512}","\u{1F513}","\u{1F6E0}\uFE0F","\u2699\uFE0F","\u{1F9F2}","\u{1F52D}"]},{icon:"\u2728",emojis:["\u2728","\u2B50","\u{1F31F}","\u{1F4AB}","\u26A1","\u{1F525}","\u{1F4A5}","\u{1F308}","\u2600\uFE0F","\u{1F327}\uFE0F","\u2744\uFE0F","\u{1F4A7}","\u{1F30A}","\u{1F30D}","\u{1F315}","\u{1F319}","\u2705","\u274C","\u2753","\u2757","\u{1F4AF}","\u2B55","\u{1F534}","\u{1F7E2}","\u{1F535}","\u26AA","\u26AB","\u{1F6A9}","\u{1F3F3}\uFE0F","\u{1F3F4}","\u{1F195}","\u{1F197}"]}];(function(){let s=document.currentScript;if(s||(s=document.querySelector("script[data-widget-key]")),!s)return;let f=s.getAttribute("data-widget-key");if(!f)return;let L=s;G();function G(Be=!1){let K=L,he=window.__orkify_visitor,ae=he,Ae=K.getAttribute("data-visitor-name")||ae?.name||"",A=K.getAttribute("data-visitor-email")||ae?.email||"",ge=K.getAttribute("data-visitor-hash")||ae?.hash||"",ie=K.getAttribute("data-klipy-key")||"",M=Me(K.src,K.getAttribute("data-api-base")),x=A?`${$e}${f}_${A}`:`${$e}${f}`;he===null&&!A&&(localStorage.removeItem(`${x}_thread`),localStorage.removeItem(`${x}_name`),localStorage.removeItem(`${x}_email`));let O=null,g=localStorage.getItem(`${x}_thread`),S=Ae||localStorage.getItem(`${x}_name`)||"",R=A||localStorage.getItem(`${x}_email`)||"",C=null,X=1e3,Re=3e4,z=null,D=!1,b=!1,P=null,v=null,$=null,N=null,se=null,H,y,w,Z=document.createElement("div");Z.id="orkify-chat-widget",document.body.appendChild(Z);let Q=Z.attachShadow({mode:"closed"});function le(){let e=document.documentElement.style.colorScheme,t;e?t=e==="dark":document.documentElement.classList.contains("dark")?t=!0:document.documentElement.dataset.theme?t=document.documentElement.dataset.theme==="dark":t=window.matchMedia("(prefers-color-scheme: dark)").matches,Z.classList.toggle("orkify-dark",t)}le();let ue=new MutationObserver(le);ue.observe(document.documentElement,{attributes:!0,attributeFilter:["class","style","data-theme"]}),window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change",le);let j=null,ce=!1;function De(e){let t=Math.max(0,Math.floor((Date.now()-e)/1e3));return t<60?"Active now":t<3600?`Active ${Math.floor(t/60)}m ago`:t<86400?`Active ${Math.floor(t/3600)}h ago`:`Active ${Math.floor(t/86400)}d ago`}function Pe(e){if(!e.isBot||!e.avatar)return;let t=new Date(e.timestamp).getTime();$&&t<$.timestamp||($={name:e.author,avatar:e.avatar,timestamp:t},ke())}function ke(){if(!N||!$)return;let e=Date.now()-$.timestamp,t=e<300*1e3,r=e<3600*1e3;N.innerHTML="",N.style.display="flex";let o=N.parentElement;if(o){let u=o.querySelector("h3");u&&(u.style.display="none");let I=o.parentElement?.querySelector(".orkify-subtitle");I&&(I.style.display="none")}let l=document.createElement("div");l.className="orkify-presence-avatar-wrap";let i=document.createElement("img");i.className="orkify-presence-avatar",i.src=$.avatar,i.alt="",l.appendChild(i);let a=document.createElement("span");a.className=`orkify-presence-dot${t?" online":r?" recent":""}`,l.appendChild(a),N.appendChild(l);let c=document.createElement("div");c.className="orkify-presence-info";let m=document.createElement("div");m.className="orkify-presence-name",m.textContent=$.name,c.appendChild(m);let p=document.createElement("div");p.className="orkify-presence-status",p.textContent=De($.timestamp),c.appendChild(p),N.appendChild(c)}async function Ue(){try{let e=await fetch(`${M}/api/chat/config?widgetKey=${f}`);if(!e.ok||(O=await e.json(),!O))return;let t=`${x}_thread_lookup`;if(A&&ge&&!g&&!sessionStorage.getItem(t)){try{let r=await fetch(`${M}/api/chat/thread?widgetKey=${f}&visitorEmail=${encodeURIComponent(A)}&visitorHash=${encodeURIComponent(ge)}`);if(r.ok){let o=await r.json();o.threadId&&(g=o.threadId,localStorage.setItem(`${x}_thread`,o.threadId))}}catch{}sessionStorage.setItem(t,"1")}Ge()}catch(e){console.error("[Orkify Chat] Init failed:",e)}}function ye(){ce||!g||(ce=!0,Je().catch(()=>{ce=!1}),U())}function Ge(){if(!O)return;let e=document.createElement("style");e.textContent=ze(O.color),Q.appendChild(e),H=document.createElement("button"),H.className="orkify-launcher",H.innerHTML=et+tt+'<span class="orkify-unread"></span>',H.addEventListener("click",ve),Q.appendChild(H),y=document.createElement("div"),y.className="orkify-panel";let t=document.createElement("div");t.className="orkify-header";let r=document.createElement("div");r.className="orkify-header-top";let o=document.createElement("h3");o.textContent=O.title;let l=document.createElement("button");l.className="orkify-close",l.title="Maximize";let i='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>',a='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>';l.innerHTML=i,l.addEventListener("click",()=>{let h=y.classList.toggle("orkify-maximized");l.innerHTML=h?a:i,l.title=h?"Restore":"Maximize"});let c=document.createElement("button");c.className="orkify-close",c.title="Close",c.innerHTML='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>',c.addEventListener("click",ve),N=document.createElement("div"),N.className="orkify-presence",N.style.display="none";let m=document.createElement("div");m.className="orkify-header-actions",m.appendChild(l),m.appendChild(c),r.appendChild(o),r.appendChild(N),r.appendChild(m),t.appendChild(r);let p=document.createElement("p");if(p.className="orkify-subtitle",p.textContent="We typically reply within a few minutes",t.appendChild(p),se=setInterval(()=>{$&&ke()},3e4),y.appendChild(t),w=document.createElement("div"),w.className="orkify-messages",!g)We();else{let h=document.createElement("div");h.className="orkify-loading",h.innerHTML='<span class="orkify-loading-dot"></span><span class="orkify-loading-dot"></span><span class="orkify-loading-dot"></span>',w.appendChild(h)}y.appendChild(w),S&&R?be():qe();let u=document.createElement("div");u.className="orkify-powered",u.innerHTML='Powered by <a href="https://orkify.com" target="_blank" rel="noopener">orkify</a>',y.appendChild(u),j=document.createElement("div"),j.className="orkify-lightbox",j.addEventListener("click",h=>{h.target===j&&de()});let T=document.createElement("div");T.className="orkify-lightbox-content";let I=document.createElement("img");I.className="orkify-lightbox-img",I.alt="",T.appendChild(I);let E=document.createElement("button");E.className="orkify-lightbox-close",E.type="button",E.innerHTML='<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>',E.addEventListener("click",de),T.appendChild(E),j.appendChild(T),Q.appendChild(y),Q.appendChild(j),Be&&(D=!0,y.classList.add("open"),H.classList.add("open"),ye())}function Ke(e){if(!j)return;let t=j.querySelector(".orkify-lightbox-img");t.src=e,j.classList.add("open"),window.addEventListener("keydown",xe)}function de(){if(!j)return;j.classList.remove("open");let e=j.querySelector(".orkify-lightbox-img");e.src="",window.removeEventListener("keydown",xe)}function xe(e){e.key==="Escape"&&de()}function We(){if(!O)return;let e=document.createElement("div");e.className="orkify-greeting";let t=document.createElement("div");t.className="orkify-greeting-icon",t.innerHTML='<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4V4c0-1.1-.9-2-2-2z"/></svg>',e.appendChild(t);let r=document.createElement("div");r.className="orkify-greeting-text",r.textContent=O.greeting,e.appendChild(r),w.appendChild(e)}function qe(){if(!O)return;let e=document.createElement("div");e.className="orkify-form";let t=document.createElement("div");t.className="orkify-form-title",t.textContent="Start a conversation",e.appendChild(t);let r=document.createElement("div");r.className="orkify-form-group";let o=document.createElement("label");o.textContent="Name";let l=document.createElement("input");l.type="text",l.placeholder="Your name",r.appendChild(o),r.appendChild(l);let i=document.createElement("div");i.className="orkify-form-group";let a=document.createElement("label");a.textContent="Email";let c=document.createElement("input");c.type="email",c.placeholder="you@example.com",i.appendChild(a),i.appendChild(c);let m=document.createElement("button");m.className="orkify-form-submit",m.textContent="Start chat",m.addEventListener("click",()=>{let p=l.value.trim(),u=c.value.trim();!p||!u||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u)||(S=p,R=u,localStorage.setItem(`${x}_name`,p),localStorage.setItem(`${x}_email`,u),e.remove(),be())}),e.appendChild(r),e.appendChild(i),e.appendChild(m),y.insertBefore(e,y.querySelector(".orkify-powered"))}function be(){let e=document.createElement("div");e.className="orkify-input-area";let t=document.createElement("div");t.className="orkify-emoji-popup";let r=document.createElement("div");r.className="orkify-emoji-tabs";let o=document.createElement("div");o.className="orkify-emoji-grid";function l(n){o.innerHTML="";for(let d of Oe[n].emojis){let k=document.createElement("button");k.className="orkify-emoji-btn",k.textContent=d,k.type="button",k.addEventListener("click",()=>{h.value+=d,h.focus(),h.dispatchEvent(new Event("input")),t.classList.remove("open")}),o.appendChild(k)}r.querySelectorAll(".orkify-emoji-tab").forEach((d,k)=>{d.classList.toggle("active",k===n)})}Oe.forEach((n,d)=>{let k=document.createElement("button");k.className="orkify-emoji-tab",k.textContent=n.icon,k.type="button",k.addEventListener("click",()=>l(d)),r.appendChild(k)}),t.appendChild(r),t.appendChild(o),l(0);let i=document.createElement("div");i.className="orkify-gif-popup";let a=document.createElement("input");a.className="orkify-gif-search",a.type="text",a.placeholder="Search GIFs...";let c=document.createElement("div");c.className="orkify-gif-grid";let m=document.createElement("div");m.className="orkify-gif-attrib",m.textContent="Powered by Klipy",i.appendChild(a),i.appendChild(c),i.appendChild(m);let p={trending:null,searches:{}},u=null;function T(n){if(c.innerHTML="",n.length===0){let d=document.createElement("div");d.className="orkify-gif-empty",d.textContent="No GIFs found",c.appendChild(d);return}for(let d of n){let k=document.createElement("img");k.className="orkify-gif-item",k.src=d.preview,k.alt="GIF",k.loading="lazy",k.addEventListener("click",()=>{i.classList.remove("open"),we(d.url)}),c.appendChild(k)}}async function I(n){if(!ie){c.innerHTML='<div class="orkify-gif-empty">GIF search not configured</div>';return}let d=n||"__trending__";if(d==="__trending__"&&p.trending){T(p.trending);return}if(p.searches[d]){T(p.searches[d]);return}c.innerHTML='<div class="orkify-gif-empty">Loading...</div>';try{let k=n?"search":"trending",J=new URLSearchParams({per_page:"20",page:"1",customer_id:"orkify_widget",content_filter:"medium"});n&&J.set("q",n);let B=await fetch(`https://api.klipy.com/api/v1/${ie}/gifs/${k}?${J}`);if(!B.ok)return;let fe=((await B.json())?.data?.data??[]).map(Ne=>{let Y=Ne.file;return{id:String(Ne.id),url:Y?.hd?.gif?.url??Y?.md?.gif?.url??"",preview:Y?.sm?.gif?.url??Y?.xs?.gif?.url??"",width:Y?.sm?.gif?.width??220,height:Y?.sm?.gif?.height??220}});n?p.searches[d]=fe:p.trending=fe,T(fe)}catch{c.innerHTML='<div class="orkify-gif-empty">Failed to load GIFs</div>'}}a.addEventListener("input",()=>{u&&clearTimeout(u),u=setTimeout(()=>I(a.value.trim()),300)});let E=document.createElement("div");E.className="orkify-input-row";let h=document.createElement("textarea");h.className="orkify-input",h.placeholder="Write a message...",h.rows=1,h.addEventListener("keydown",n=>{n.key==="Enter"&&!n.shiftKey&&(n.preventDefault(),P?je(P):Ce(h))}),h.addEventListener("input",()=>{h.style.height="auto",h.style.height=Math.min(h.scrollHeight,80)+"px"});let W=document.createElement("button");W.className="orkify-emoji-toggle",W.innerHTML=rt,W.type="button",W.addEventListener("click",n=>{n.stopPropagation(),i.classList.remove("open"),t.classList.toggle("open")});let q=document.createElement("button");q.className="orkify-gif-toggle",q.innerHTML=it,q.type="button",q.addEventListener("click",n=>{n.stopPropagation(),t.classList.remove("open");let d=!i.classList.contains("open");i.classList.toggle("open"),d&&I(a.value.trim())}),Q.addEventListener("click",n=>{let d=n.target;!t.contains(d)&&d!==W&&t.classList.remove("open"),!i.contains(d)&&d!==q&&i.classList.remove("open")});let _=document.createElement("input");_.type="file",_.style.display="none",_.accept=Array.from(He).join(","),_.addEventListener("change",()=>{_.files?.[0]&&Ie(_.files[0]),_.value=""});let oe=document.createElement("button");oe.className="orkify-attach-toggle",oe.innerHTML=nt,oe.type="button",oe.addEventListener("click",n=>{n.stopPropagation(),t.classList.remove("open"),i.classList.remove("open"),_.click()});function Ie(n){if(!He.has(n.type)){alert("File type not supported");return}if(n.size>at){alert("File too large (max 8 MB)");return}P=n,Ye(n)}function Ye(n){if(Se(),v=document.createElement("div"),v.className="orkify-file-preview",n.type.startsWith("image/")){let F=document.createElement("img");F.className="orkify-file-preview-thumb",F.src=URL.createObjectURL(n),F.alt="",v.appendChild(F)}else{let F=document.createElement("div");F.className="orkify-file-preview-icon",F.textContent=Fe(n.type),v.appendChild(F)}let d=document.createElement("div");d.className="orkify-file-preview-info";let k=document.createElement("div");k.className="orkify-file-preview-name",k.textContent=n.name,d.appendChild(k);let J=document.createElement("div");J.className="orkify-file-preview-size",J.textContent=_e(n.size),d.appendChild(J),v.appendChild(d);let B=document.createElement("button");B.className="orkify-file-preview-remove",B.type="button",B.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>',B.addEventListener("click",()=>{P=null,Se()}),v.appendChild(B),e.insertBefore(v,E)}function Se(){if(v){let n=v.querySelector(".orkify-file-preview-thumb");n&&URL.revokeObjectURL(n.src),v.remove(),v=null}}let re=0;y.addEventListener("dragenter",n=>{n.preventDefault(),re++,y.classList.add("orkify-dragover")}),y.addEventListener("dragleave",()=>{re--,re<=0&&(re=0,y.classList.remove("orkify-dragover"))}),y.addEventListener("dragover",n=>{n.preventDefault()}),y.addEventListener("drop",n=>{n.preventDefault(),re=0,y.classList.remove("orkify-dragover");let d=n.dataTransfer?.files[0];d&&Ie(d)});let ne=document.createElement("button");ne.className="orkify-send",ne.innerHTML=ot,ne.addEventListener("click",()=>{P?je(P):Ce(h)});let V=document.createElement("div");V.className="orkify-input-actions",V.appendChild(oe),V.appendChild(W),ie&&V.appendChild(q),V.appendChild(ne),E.appendChild(h),E.appendChild(V),e.appendChild(_),e.appendChild(t),ie&&e.appendChild(i),e.appendChild(E),y.insertBefore(e,y.querySelector(".orkify-powered"))}function pe(){requestAnimationFrame(()=>{requestAnimationFrame(()=>{w.scrollTop=w.scrollHeight})})}function ve(){if((window.__orkify_visitor?.email||"")!==A){C&&C.close(),z&&clearTimeout(z),Z.remove(),G(!0);return}D=!D,y.classList.toggle("open",D),H.classList.toggle("open",D),D&&(H.classList.remove("orkify-has-unread"),ye(),pe())}function ee(e){Pe(e),!D&&e.isBot&&H.classList.add("orkify-has-unread");let t=w.querySelector(".orkify-greeting");t&&t.remove();let r=document.createElement("div");r.className=`orkify-msg ${e.isBot?"orkify-msg-support":"orkify-msg-visitor"}`;let o=r;if(e.isBot){if(e.avatar){let a=document.createElement("img");a.className="orkify-msg-avatar",a.src=e.avatar,a.alt="",r.appendChild(a)}o=document.createElement("div"),o.className="orkify-msg-bubble";let i=document.createElement("div");i.className="orkify-msg-author",i.textContent=e.author,o.appendChild(i),r.appendChild(o)}if(e.content){let i=document.createElement("div");i.textContent=e.content,o.appendChild(i)}if(e.attachments)for(let i of e.attachments)if(i.contentType==="application/json+lottie"){let a=document.createElement("div");a.className="orkify-msg-image orkify-lottie",a.style.width="200px",a.style.height="200px",o.appendChild(a),st().then(c=>{let m=i.url.split(",")[1],p=JSON.parse(atob(m));c.loadAnimation({container:a,renderer:"svg",loop:!0,autoplay:!0,animationData:p})}).catch(()=>{a.textContent="(sticker)"})}else if(i.contentType.startsWith("image/")){let a=document.createElement("div");a.className="orkify-img-wrap";let c=document.createElement("img");c.className="orkify-msg-image",c.src=i.url,c.alt=i.filename,c.loading="lazy",c.addEventListener("load",pe),a.appendChild(c);let m=document.createElement("div");m.className="orkify-img-actions";let p=document.createElement("button");p.className="orkify-img-btn",p.type="button",p.title="View full size",p.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>',p.addEventListener("click",()=>Ke(i.url));let u=document.createElement("button");u.className="orkify-img-btn",u.type="button",u.title="Download",u.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',u.addEventListener("click",async()=>{try{let I=await(await fetch(i.url)).blob(),E=URL.createObjectURL(I),h=document.createElement("a");h.href=E,h.download=i.filename,h.click(),URL.revokeObjectURL(E)}catch{window.open(i.url,"_blank")}}),m.appendChild(p),m.appendChild(u),a.appendChild(m),o.appendChild(a)}else{let a=document.createElement("a");a.className="orkify-file-card",a.href=i.url,a.target="_blank",a.rel="noopener";let c=document.createElement("span");c.className="orkify-file-card-icon",c.textContent=Fe(i.contentType),a.appendChild(c);let m=document.createElement("div");m.className="orkify-file-card-info";let p=document.createElement("div");if(p.className="orkify-file-card-name",p.textContent=i.filename,m.appendChild(p),i.size>0){let u=document.createElement("div");u.className="orkify-file-card-size",u.textContent=_e(i.size),m.appendChild(u)}a.appendChild(m),o.appendChild(a)}let l=document.createElement("div");return l.className="orkify-msg-time",l.textContent=new Date(e.timestamp).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}),o.appendChild(l),w.appendChild(r),w.scrollTop=w.scrollHeight,r}function Ve(e){e.classList.remove("orkify-msg-failed");let t=e.querySelector(".orkify-msg-error");t&&t.remove()}function te(e,t){if(e.classList.add("orkify-msg-failed"),e.querySelector(".orkify-msg-error"))return;let r=document.createElement("div");r.className="orkify-msg-error",r.textContent="\u26A0 Failed to send \xB7 ";let o=document.createElement("button");o.type="button",o.textContent="Tap to retry",o.addEventListener("click",()=>{Ve(e),t()}),r.appendChild(o),e.appendChild(r),w.scrollTop=w.scrollHeight}async function we(e){if(b)return;b=!0;let t=ee({content:"",attachments:[{url:e,filename:"gif",contentType:"image/gif",size:0}],author:S,timestamp:new Date().toISOString(),isBot:!1});try{let r=await fetch(`${M}/api/chat/send?widgetKey=${f}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({widgetKey:f,message:e,threadId:g,visitorName:S,visitorEmail:R})});if(!r.ok)throw new Error("Send failed");let o=await r.json();o.threadId&&o.threadId!==g&&(g=o.threadId,localStorage.setItem(`${x}_thread`,o.threadId),U())}catch(r){console.error("[Orkify Chat] Send GIF error:",r),te(t,()=>we(e))}finally{b=!1}}async function Ee(e,t){if(!b){b=!0;try{let r=await fetch(`${M}/api/chat/send?widgetKey=${f}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({widgetKey:f,message:e,threadId:g,visitorName:S,visitorEmail:R})});if(!r.ok)throw new Error("Send failed");let o=await r.json();o.threadId&&o.threadId!==g&&(g=o.threadId,localStorage.setItem(`${x}_thread`,o.threadId),U())}catch(r){console.error("[Orkify Chat] Send error:",r),te(t,()=>Ee(e,t))}finally{b=!1}}}async function Ce(e){let t=e.value.trim();if(!t||b)return;b=!0,e.value="",e.style.height="auto";let r=ee({content:t,author:S,timestamp:new Date().toISOString(),isBot:!1});try{let o=await fetch(`${M}/api/chat/send?widgetKey=${f}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({widgetKey:f,message:t,threadId:g,visitorName:S,visitorEmail:R})});if(!o.ok)throw new Error("Send failed");let l=await o.json();l.threadId&&l.threadId!==g&&(g=l.threadId,localStorage.setItem(`${x}_thread`,l.threadId),U())}catch(o){console.error("[Orkify Chat] Send error:",o),te(r,()=>Ee(t,r))}finally{b=!1}}async function Le(e,t){if(!b){b=!0;try{let r=new FormData;r.append("file",e),f&&r.append("widgetKey",f),r.append("visitorName",S),r.append("visitorEmail",R),g&&r.append("threadId",g);let o=await fetch(`${M}/api/chat/upload?widgetKey=${f}`,{method:"POST",body:r});if(!o.ok)throw new Error("Upload failed");let l=await o.json();l.threadId&&l.threadId!==g&&(g=l.threadId,localStorage.setItem(`${x}_thread`,l.threadId),U())}catch(r){console.error("[Orkify Chat] Upload error:",r),te(t,()=>Le(e,t))}finally{b=!1}}}async function je(e){if(b)return;b=!0;let t=e.type.startsWith("image/")?URL.createObjectURL(e):"",r=ee({content:"",attachments:[{url:t,filename:e.name,contentType:e.type,size:e.size}],author:S,timestamp:new Date().toISOString(),isBot:!1});if(P=null,v){let o=v.querySelector(".orkify-file-preview-thumb");o&&URL.revokeObjectURL(o.src),v.remove(),v=null}try{let o=new FormData;o.append("file",e),f&&o.append("widgetKey",f),o.append("visitorName",S),o.append("visitorEmail",R),g&&o.append("threadId",g);let l=await fetch(`${M}/api/chat/upload?widgetKey=${f}`,{method:"POST",body:o});if(!l.ok)throw new Error("Upload failed");let i=await l.json();i.threadId&&i.threadId!==g&&(g=i.threadId,localStorage.setItem(`${x}_thread`,i.threadId),U())}catch(o){console.error("[Orkify Chat] Upload error:",o),te(r,()=>Le(e,r))}finally{b=!1,t&&URL.revokeObjectURL(t)}}function U(){g&&(C&&C.close(),z&&(clearTimeout(z),z=null),C=new EventSource(`${M}/api/chat/stream?widgetKey=${f}&threadId=${g}`),C.onopen=()=>{X=1e3},C.onmessage=e=>{try{let t=JSON.parse(e.data);t.type==="message"&&ee(t)}catch{}},C.onerror=()=>{C&&(C.close(),C=null),console.warn(`[Orkify Chat] SSE error, reconnecting in ${X/1e3}s`),z=setTimeout(()=>{z=null,U()},X),X=Math.min(X*2,Re)})}async function Je(){if(g)try{let e=await fetch(`${M}/api/chat/history?widgetKey=${f}&threadId=${g}`);if(!e.ok){e.status===404&&(g=null,localStorage.removeItem(`${x}_thread`));return}let t=await e.json(),r=w.querySelector(".orkify-loading");if(r&&r.remove(),t.messages){for(let o of t.messages)ee(o);pe()}}catch(e){throw console.error("[Orkify Chat] History error:",e),e}}window.addEventListener("beforeunload",()=>{C&&C.close(),z&&clearTimeout(z),se&&clearInterval(se),ue.disconnect()}),Ue()}})();})();
