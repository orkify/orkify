/* eslint-disable no-console */
import { resolveApiBase } from '../api-base.js';
import { getStyles } from './styles.js';

interface WidgetConfig {
  title: string;
  color: string;
  greeting: string;
}

interface ChatAttachment {
  url: string;
  filename: string;
  contentType: string;
  size: number;
}

interface ChatMessage {
  content: string;
  author: string;
  timestamp: string;
  isBot: boolean;
  attachments?: ChatAttachment[];
  avatar?: string;
}

const STORAGE_PREFIX = 'orkify_chat_';

const ICON_CHAT = `<svg class="orkify-icon-chat" viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4V4c0-1.1-.9-2-2-2zm0 15.17L18.83 16H4V4h16v13.17z"/></svg>`;
const ICON_CLOSE = `<svg class="orkify-icon-close" viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`;
const ICON_SEND = `<svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>`;
const ICON_EMOJI = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>`;
const ICON_GIF = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="3"/><text x="12" y="15" text-anchor="middle" font-size="8" font-weight="700" fill="currentColor" stroke="none">GIF</text></svg>`;
const ICON_ATTACH = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>`;

const MAX_FILE_SIZE = 8 * 1024 * 1024;

const ALLOWED_FILE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/zip',
]);

// Minimal type for the subset of lottie-web API we use
interface LottieAPI {
  loadAnimation(params: {
    container: HTMLElement;
    renderer: string;
    loop: boolean;
    autoplay: boolean;
    animationData: unknown;
  }): void;
}

// Lazy-load lottie-web only when a Lottie sticker is encountered
let lottiePromise: null | Promise<LottieAPI> = null;
function loadLottie(): Promise<LottieAPI> {
  if (!lottiePromise) {
    lottiePromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/lottie-web/5.12.2/lottie.min.js';
      script.onload = () => resolve((window as unknown as Record<string, LottieAPI>).lottie);
      script.onerror = () => reject(new Error('Failed to load lottie-web'));
      document.head.appendChild(script);
    });
  }
  return lottiePromise;
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(contentType: string): string {
  if (contentType.startsWith('image/')) return '\u{1F5BC}';
  if (contentType === 'application/pdf') return '\u{1F4C4}';
  if (contentType.startsWith('text/')) return '\u{1F4DD}';
  if (contentType === 'application/zip') return '\u{1F4E6}';
  return '\u{1F4CE}';
}

const EMOJI_CATEGORIES: { icon: string; emojis: string[] }[] = [
  {
    icon: '😀',
    emojis: [
      '😀',
      '😃',
      '😄',
      '😁',
      '😆',
      '😅',
      '🤣',
      '😂',
      '🙂',
      '😊',
      '😇',
      '🥰',
      '😍',
      '🤩',
      '😘',
      '😋',
      '😛',
      '🤔',
      '🤫',
      '🤭',
      '😏',
      '😌',
      '😴',
      '🤯',
      '😎',
      '🥸',
      '😤',
      '🥹',
      '😢',
      '😭',
      '😱',
      '🥺',
    ],
  },
  {
    icon: '👋',
    emojis: [
      '👋',
      '🤚',
      '🖐️',
      '✋',
      '👌',
      '🤌',
      '✌️',
      '🤞',
      '🤟',
      '🤘',
      '🤙',
      '👍',
      '👎',
      '✊',
      '👊',
      '👏',
      '🙌',
      '🫶',
      '👐',
      '🤝',
      '🙏',
      '💪',
      '🫡',
      '👈',
      '👉',
      '👆',
      '👇',
      '☝️',
      '👀',
      '🧠',
      '💀',
      '🫵',
    ],
  },
  {
    icon: '❤️',
    emojis: [
      '❤️',
      '🧡',
      '💛',
      '💚',
      '💙',
      '💜',
      '🖤',
      '🤍',
      '🤎',
      '💔',
      '❤️‍🔥',
      '❤️‍🩹',
      '💕',
      '💞',
      '💓',
      '💗',
      '💖',
      '💘',
      '💝',
      '💟',
      '💋',
      '💌',
      '💐',
      '🌹',
      '🥀',
      '🌸',
      '🌺',
      '🌻',
      '🌼',
      '🌷',
      '💮',
      '♥️',
    ],
  },
  {
    icon: '🎉',
    emojis: [
      '🎉',
      '🎊',
      '🎈',
      '🎁',
      '🎀',
      '🏆',
      '🥇',
      '🥈',
      '🥉',
      '⚽',
      '🏀',
      '🎮',
      '🎯',
      '🎲',
      '🎭',
      '🎨',
      '🎬',
      '🎤',
      '🎧',
      '🎵',
      '🎶',
      '🎹',
      '🎸',
      '🥁',
      '🎺',
      '🎻',
      '🎪',
      '🎟️',
      '🎰',
      '🎳',
      '🏅',
      '🎗️',
    ],
  },
  {
    icon: '🚀',
    emojis: [
      '🚀',
      '✈️',
      '🚗',
      '🚕',
      '🏎️',
      '🚓',
      '🚑',
      '🚒',
      '🛸',
      '⛵',
      '🚢',
      '⏰',
      '🔔',
      '📱',
      '💻',
      '🖥️',
      '📸',
      '💡',
      '🔋',
      '🔌',
      '📦',
      '📝',
      '📎',
      '✂️',
      '📌',
      '🔑',
      '🔒',
      '🔓',
      '🛠️',
      '⚙️',
      '🧲',
      '🔭',
    ],
  },
  {
    icon: '✨',
    emojis: [
      '✨',
      '⭐',
      '🌟',
      '💫',
      '⚡',
      '🔥',
      '💥',
      '🌈',
      '☀️',
      '🌧️',
      '❄️',
      '💧',
      '🌊',
      '🌍',
      '🌕',
      '🌙',
      '✅',
      '❌',
      '❓',
      '❗',
      '💯',
      '⭕',
      '🔴',
      '🟢',
      '🔵',
      '⚪',
      '⚫',
      '🚩',
      '🏳️',
      '🏴',
      '🆕',
      '🆗',
    ],
  },
];

(function () {
  let scriptTag = document.currentScript as HTMLScriptElement | null;
  if (!scriptTag) {
    scriptTag = document.querySelector('script[data-widget-key]') as HTMLScriptElement | null;
  }
  if (!scriptTag) return;

  const widgetKey = scriptTag.getAttribute('data-widget-key');
  if (!widgetKey) return;

  const resolvedScriptTag = scriptTag;
  initWidget();

  function initWidget(autoOpen = false) {
    const scriptTag = resolvedScriptTag;
    // Visitor data: data attributes > window.__orkify_visitor (set by dashboard) > localStorage
    // __orkify_visitor === null means session-aware site with no logged-in user (clear stale data)
    // __orkify_visitor === undefined means third-party site (preserve localStorage across visits)
    const rawVisitor = (window as unknown as Record<string, unknown>).__orkify_visitor;
    const windowVisitor = rawVisitor as
      | null
      | undefined
      | { name?: string; email?: string; hash?: string };
    const presetName = scriptTag.getAttribute('data-visitor-name') || windowVisitor?.name || '';
    const presetEmail = scriptTag.getAttribute('data-visitor-email') || windowVisitor?.email || '';
    const visitorHash = scriptTag.getAttribute('data-visitor-hash') || windowVisitor?.hash || '';
    const klipyKey = scriptTag.getAttribute('data-klipy-key') || '';
    // Not simply the script's origin: loaded from a CDN, that is the CDN. See
    // lib/chat/api-base.ts.
    const baseUrl = resolveApiBase(scriptTag.src, scriptTag.getAttribute('data-api-base'));

    // Identity-aware storage key: logged-in users get per-email threads
    const storageId = presetEmail
      ? `${STORAGE_PREFIX}${widgetKey}_${presetEmail}`
      : `${STORAGE_PREFIX}${widgetKey}`;

    // Session-aware site with no logged-in user: clear stale generic data so logged-out
    // users don't see a previous user's conversation
    if (rawVisitor === null && !presetEmail) {
      localStorage.removeItem(`${storageId}_thread`);
      localStorage.removeItem(`${storageId}_name`);
      localStorage.removeItem(`${storageId}_email`);
    }

    let config: null | WidgetConfig = null;
    let threadId: null | string = localStorage.getItem(`${storageId}_thread`);
    let visitorName = presetName || localStorage.getItem(`${storageId}_name`) || '';
    let visitorEmail = presetEmail || localStorage.getItem(`${storageId}_email`) || '';
    let eventSource: EventSource | null = null;
    let sseBackoff = 1000;
    const SSE_BACKOFF_MAX = 30_000;
    let sseReconnectTimer: null | ReturnType<typeof setTimeout> = null;
    let isOpen = false;
    let isSending = false;
    let pendingFile: File | null = null;
    let filePreviewEl: HTMLDivElement | null = null;

    // Agent presence
    let lastAgent: null | { name: string; avatar: string; timestamp: number } = null;
    let presenceEl: HTMLDivElement | null = null;
    let presenceTimer: null | ReturnType<typeof setInterval> = null;

    // DOM refs
    let launcher: HTMLButtonElement;
    let panel: HTMLDivElement;
    let messagesEl: HTMLDivElement;

    const host = document.createElement('div');
    host.id = 'orkify-chat-widget';
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'closed' });

    // ── Dark mode detection ──
    // Priority: style.colorScheme (next-themes sets this) > dark class > OS preference.
    // next-themes sets style="color-scheme: dark|light" on <html>, which is the
    // definitive source even when the OS preference differs from the user's choice.
    // For third-party sites without next-themes, we fall back to OS preference.
    function syncDarkMode() {
      const colorScheme = document.documentElement.style.colorScheme;
      let dark: boolean;
      if (colorScheme) {
        // Site actively manages theme (next-themes etc.) — trust it
        dark = colorScheme === 'dark';
      } else if (document.documentElement.classList.contains('dark')) {
        // Class-based without color-scheme style
        dark = true;
      } else if (document.documentElement.dataset.theme) {
        // data-theme attribute
        dark = document.documentElement.dataset.theme === 'dark';
      } else {
        // No site-level theme management — fall back to OS preference
        dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      }
      host.classList.toggle('orkify-dark', dark);
    }

    syncDarkMode();

    // Watch for class and style changes on <html> (next-themes toggles both)
    const themeObserver = new MutationObserver(syncDarkMode);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style', 'data-theme'],
    });

    // Watch for OS-level preference changes (fallback for third-party sites)
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncDarkMode);

    let lightboxEl: HTMLDivElement | null = null;

    let sessionLoaded = false;

    function timeAgo(ts: number): string {
      const diff = Math.max(0, Math.floor((Date.now() - ts) / 1000));
      if (diff < 60) return 'Active now';
      if (diff < 3600) return `Active ${Math.floor(diff / 60)}m ago`;
      if (diff < 86400) return `Active ${Math.floor(diff / 3600)}h ago`;
      return `Active ${Math.floor(diff / 86400)}d ago`;
    }

    function updatePresence(msg: ChatMessage) {
      if (!msg.isBot || !msg.avatar) return;
      const ts = new Date(msg.timestamp).getTime();
      if (lastAgent && ts < lastAgent.timestamp) return; // older message
      lastAgent = { name: msg.author, avatar: msg.avatar, timestamp: ts };
      renderPresence();
    }

    function renderPresence() {
      if (!presenceEl || !lastAgent) return;
      const age = Date.now() - lastAgent.timestamp;
      const isOnline = age < 5 * 60 * 1000; // <5min = online
      const isRecent = age < 60 * 60 * 1000; // <1h = recently active

      presenceEl.innerHTML = '';
      presenceEl.style.display = 'flex';

      // Hide title and subtitle — presence replaces them
      const headerTop = presenceEl.parentElement;
      if (headerTop) {
        const titleEl = headerTop.querySelector('h3') as HTMLElement;
        if (titleEl) titleEl.style.display = 'none';
        const headerEl = headerTop.parentElement;
        const subtitleEl = headerEl?.querySelector('.orkify-subtitle') as HTMLElement;
        if (subtitleEl) subtitleEl.style.display = 'none';
      }

      const avatarWrap = document.createElement('div');
      avatarWrap.className = 'orkify-presence-avatar-wrap';

      const avatarImg = document.createElement('img');
      avatarImg.className = 'orkify-presence-avatar';
      avatarImg.src = lastAgent.avatar;
      avatarImg.alt = '';
      avatarWrap.appendChild(avatarImg);

      const dot = document.createElement('span');
      dot.className = `orkify-presence-dot${isOnline ? ' online' : isRecent ? ' recent' : ''}`;
      avatarWrap.appendChild(dot);

      presenceEl.appendChild(avatarWrap);

      const info = document.createElement('div');
      info.className = 'orkify-presence-info';

      const name = document.createElement('div');
      name.className = 'orkify-presence-name';
      name.textContent = lastAgent.name;
      info.appendChild(name);

      const status = document.createElement('div');
      status.className = 'orkify-presence-status';
      status.textContent = timeAgo(lastAgent.timestamp);
      info.appendChild(status);

      presenceEl.appendChild(info);
    }

    async function init() {
      try {
        const res = await fetch(`${baseUrl}/api/chat/config?widgetKey=${widgetKey}`);
        if (!res.ok) return;
        config = await res.json();
        if (!config) return;

        // Cross-browser thread restoration: if logged-in user has no local threadId,
        // ask the server to find their existing thread via HMAC-verified email lookup.
        // sessionStorage sentinel ensures one API call per tab session (new tab re-checks).
        const lookupKey = `${storageId}_thread_lookup`;
        if (presetEmail && visitorHash && !threadId && !sessionStorage.getItem(lookupKey)) {
          try {
            const threadRes = await fetch(
              `${baseUrl}/api/chat/thread?widgetKey=${widgetKey}&visitorEmail=${encodeURIComponent(presetEmail)}&visitorHash=${encodeURIComponent(visitorHash)}`
            );
            if (threadRes.ok) {
              const data = await threadRes.json();
              if (data.threadId) {
                threadId = data.threadId;
                localStorage.setItem(`${storageId}_thread`, data.threadId);
              }
            }
          } catch {
            // Thread lookup is best-effort — widget works fine without it
          }
          sessionStorage.setItem(lookupKey, '1');
        }

        render();
      } catch (e) {
        console.error('[Orkify Chat] Init failed:', e);
      }
    }

    /** Load history + connect SSE on first open (lazy). */
    function ensureSession() {
      if (sessionLoaded || !threadId) return;
      sessionLoaded = true;
      loadHistory().catch(() => {
        sessionLoaded = false; // Allow retry on next open
      });
      connectSSE();
    }

    function render() {
      if (!config) return;

      const style = document.createElement('style');
      style.textContent = getStyles(config.color);
      shadow.appendChild(style);

      // Launcher button
      launcher = document.createElement('button');
      launcher.className = 'orkify-launcher';
      launcher.innerHTML = ICON_CHAT + ICON_CLOSE + '<span class="orkify-unread"></span>';
      launcher.addEventListener('click', toggle);
      shadow.appendChild(launcher);

      // Panel
      panel = document.createElement('div');
      panel.className = 'orkify-panel';

      // Header
      const header = document.createElement('div');
      header.className = 'orkify-header';

      const headerTop = document.createElement('div');
      headerTop.className = 'orkify-header-top';

      const title = document.createElement('h3');
      title.textContent = config.title;

      const maximizeBtn = document.createElement('button');
      maximizeBtn.className = 'orkify-close';
      maximizeBtn.title = 'Maximize';
      const iconExpand = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`;
      const iconShrink = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`;
      maximizeBtn.innerHTML = iconExpand;
      maximizeBtn.addEventListener('click', () => {
        const maximized = panel.classList.toggle('orkify-maximized');
        maximizeBtn.innerHTML = maximized ? iconShrink : iconExpand;
        maximizeBtn.title = maximized ? 'Restore' : 'Maximize';
      });

      const closeBtn = document.createElement('button');
      closeBtn.className = 'orkify-close';
      closeBtn.title = 'Close';
      closeBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>`;
      closeBtn.addEventListener('click', toggle);

      // Presence — hidden until a support agent replies, sits in header-top row
      presenceEl = document.createElement('div');
      presenceEl.className = 'orkify-presence';
      presenceEl.style.display = 'none';

      const headerActions = document.createElement('div');
      headerActions.className = 'orkify-header-actions';
      headerActions.appendChild(maximizeBtn);
      headerActions.appendChild(closeBtn);

      headerTop.appendChild(title);
      headerTop.appendChild(presenceEl);
      headerTop.appendChild(headerActions);
      header.appendChild(headerTop);

      const subtitle = document.createElement('p');
      subtitle.className = 'orkify-subtitle';
      subtitle.textContent = 'We typically reply within a few minutes';
      header.appendChild(subtitle);

      // Refresh presence text every 30s
      presenceTimer = setInterval(() => {
        if (lastAgent) renderPresence();
      }, 30_000);

      panel.appendChild(header);

      // Messages area
      messagesEl = document.createElement('div');
      messagesEl.className = 'orkify-messages';

      if (!threadId) {
        renderGreeting();
      } else {
        const loader = document.createElement('div');
        loader.className = 'orkify-loading';
        loader.innerHTML =
          '<span class="orkify-loading-dot"></span>' +
          '<span class="orkify-loading-dot"></span>' +
          '<span class="orkify-loading-dot"></span>';
        messagesEl.appendChild(loader);
      }

      panel.appendChild(messagesEl);

      // Form or input
      if (visitorName && visitorEmail) {
        renderInputArea();
      } else {
        renderForm();
      }

      // Powered by
      const powered = document.createElement('div');
      powered.className = 'orkify-powered';
      powered.innerHTML =
        'Powered by <a href="https://orkify.com" target="_blank" rel="noopener">orkify</a>';
      panel.appendChild(powered);

      // Lightbox overlay
      lightboxEl = document.createElement('div');
      lightboxEl.className = 'orkify-lightbox';
      lightboxEl.addEventListener('click', (e) => {
        if (e.target === lightboxEl) closeLightbox();
      });

      const lightboxContent = document.createElement('div');
      lightboxContent.className = 'orkify-lightbox-content';

      const lightboxImg = document.createElement('img');
      lightboxImg.className = 'orkify-lightbox-img';
      lightboxImg.alt = '';
      lightboxContent.appendChild(lightboxImg);

      const lightboxClose = document.createElement('button');
      lightboxClose.className = 'orkify-lightbox-close';
      lightboxClose.type = 'button';
      lightboxClose.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>`;
      lightboxClose.addEventListener('click', closeLightbox);
      lightboxContent.appendChild(lightboxClose);

      lightboxEl.appendChild(lightboxContent);

      shadow.appendChild(panel);

      shadow.appendChild(lightboxEl);

      if (autoOpen) {
        isOpen = true;
        panel.classList.add('open');
        launcher.classList.add('open');
        ensureSession();
      }
    }

    function showLightbox(url: string) {
      if (!lightboxEl) return;
      const img = lightboxEl.querySelector('.orkify-lightbox-img') as HTMLImageElement;
      img.src = url;
      lightboxEl.classList.add('open');
      window.addEventListener('keydown', lightboxKeyHandler);
    }

    function closeLightbox() {
      if (!lightboxEl) return;
      lightboxEl.classList.remove('open');
      const img = lightboxEl.querySelector('.orkify-lightbox-img') as HTMLImageElement;
      img.src = '';
      window.removeEventListener('keydown', lightboxKeyHandler);
    }

    function lightboxKeyHandler(e: KeyboardEvent) {
      if (e.key === 'Escape') closeLightbox();
    }

    function renderGreeting() {
      if (!config) return;
      const wrap = document.createElement('div');
      wrap.className = 'orkify-greeting';

      const icon = document.createElement('div');
      icon.className = 'orkify-greeting-icon';
      icon.innerHTML = `<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4V4c0-1.1-.9-2-2-2z"/></svg>`;
      wrap.appendChild(icon);

      const text = document.createElement('div');
      text.className = 'orkify-greeting-text';
      text.textContent = config.greeting;
      wrap.appendChild(text);

      messagesEl.appendChild(wrap);
    }

    function renderForm() {
      if (!config) return;

      const form = document.createElement('div');
      form.className = 'orkify-form';

      const formTitle = document.createElement('div');
      formTitle.className = 'orkify-form-title';
      formTitle.textContent = 'Start a conversation';
      form.appendChild(formTitle);

      const nameGroup = document.createElement('div');
      nameGroup.className = 'orkify-form-group';
      const nameLabel = document.createElement('label');
      nameLabel.textContent = 'Name';
      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.placeholder = 'Your name';
      nameGroup.appendChild(nameLabel);
      nameGroup.appendChild(nameInput);

      const emailGroup = document.createElement('div');
      emailGroup.className = 'orkify-form-group';
      const emailLabel = document.createElement('label');
      emailLabel.textContent = 'Email';
      const emailInput = document.createElement('input');
      emailInput.type = 'email';
      emailInput.placeholder = 'you@example.com';
      emailGroup.appendChild(emailLabel);
      emailGroup.appendChild(emailInput);

      const submit = document.createElement('button');
      submit.className = 'orkify-form-submit';
      submit.textContent = 'Start chat';
      submit.addEventListener('click', () => {
        const name = nameInput.value.trim();
        const email = emailInput.value.trim();
        if (!name || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;
        visitorName = name;
        visitorEmail = email;
        localStorage.setItem(`${storageId}_name`, name);
        localStorage.setItem(`${storageId}_email`, email);
        form.remove();
        renderInputArea();
      });

      form.appendChild(nameGroup);
      form.appendChild(emailGroup);
      form.appendChild(submit);
      panel.insertBefore(form, panel.querySelector('.orkify-powered'));
    }

    function renderInputArea() {
      const area = document.createElement('div');
      area.className = 'orkify-input-area';

      // Emoji picker popup
      const emojiPopup = document.createElement('div');
      emojiPopup.className = 'orkify-emoji-popup';

      const emojiTabs = document.createElement('div');
      emojiTabs.className = 'orkify-emoji-tabs';

      const emojiGrid = document.createElement('div');
      emojiGrid.className = 'orkify-emoji-grid';

      function showCategory(index: number) {
        emojiGrid.innerHTML = '';
        for (const emoji of EMOJI_CATEGORIES[index].emojis) {
          const btn = document.createElement('button');
          btn.className = 'orkify-emoji-btn';
          btn.textContent = emoji;
          btn.type = 'button';
          btn.addEventListener('click', () => {
            textarea.value += emoji;
            textarea.focus();
            textarea.dispatchEvent(new Event('input'));
            emojiPopup.classList.remove('open');
          });
          emojiGrid.appendChild(btn);
        }
        // Update active tab
        emojiTabs.querySelectorAll('.orkify-emoji-tab').forEach((t, i) => {
          t.classList.toggle('active', i === index);
        });
      }

      EMOJI_CATEGORIES.forEach((cat, i) => {
        const tab = document.createElement('button');
        tab.className = 'orkify-emoji-tab';
        tab.textContent = cat.icon;
        tab.type = 'button';
        tab.addEventListener('click', () => showCategory(i));
        emojiTabs.appendChild(tab);
      });

      emojiPopup.appendChild(emojiTabs);
      emojiPopup.appendChild(emojiGrid);
      showCategory(0);

      // GIF picker popup
      const gifPopup = document.createElement('div');
      gifPopup.className = 'orkify-gif-popup';

      const gifSearch = document.createElement('input');
      gifSearch.className = 'orkify-gif-search';
      gifSearch.type = 'text';
      gifSearch.placeholder = 'Search GIFs...';

      const gifGrid = document.createElement('div');
      gifGrid.className = 'orkify-gif-grid';

      const gifAttrib = document.createElement('div');
      gifAttrib.className = 'orkify-gif-attrib';
      gifAttrib.textContent = 'Powered by Klipy';

      gifPopup.appendChild(gifSearch);
      gifPopup.appendChild(gifGrid);
      gifPopup.appendChild(gifAttrib);

      const gifCache: { trending: null | unknown[]; searches: Record<string, unknown[]> } = {
        trending: null,
        searches: {},
      };
      let gifDebounce: null | ReturnType<typeof setTimeout> = null;

      function renderGifs(
        results: { id: string; url: string; preview: string; width: number; height: number }[]
      ) {
        gifGrid.innerHTML = '';
        if (results.length === 0) {
          const empty = document.createElement('div');
          empty.className = 'orkify-gif-empty';
          empty.textContent = 'No GIFs found';
          gifGrid.appendChild(empty);
          return;
        }
        for (const gif of results) {
          const item = document.createElement('img');
          item.className = 'orkify-gif-item';
          item.src = gif.preview;
          item.alt = 'GIF';
          item.loading = 'lazy';
          item.addEventListener('click', () => {
            gifPopup.classList.remove('open');
            sendGif(gif.url);
          });
          gifGrid.appendChild(item);
        }
      }

      type GifResult = { id: string; url: string; preview: string; width: number; height: number };

      async function fetchGifs(query: string) {
        if (!klipyKey) {
          gifGrid.innerHTML = '<div class="orkify-gif-empty">GIF search not configured</div>';
          return;
        }

        const cacheKey = query || '__trending__';
        if (cacheKey === '__trending__' && gifCache.trending) {
          renderGifs(gifCache.trending as GifResult[]);
          return;
        }
        if (gifCache.searches[cacheKey]) {
          renderGifs(gifCache.searches[cacheKey] as GifResult[]);
          return;
        }

        gifGrid.innerHTML = '<div class="orkify-gif-empty">Loading...</div>';
        try {
          const endpoint = query ? 'search' : 'trending';
          const params = new URLSearchParams({
            per_page: '20',
            page: '1',
            customer_id: 'orkify_widget',
            content_filter: 'medium',
          });
          if (query) params.set('q', query);
          const res = await fetch(
            `https://api.klipy.com/api/v1/${klipyKey}/gifs/${endpoint}?${params}`
          );
          if (!res.ok) return;
          const json = await res.json();
          const items = json?.data?.data ?? [];
          const results: GifResult[] = items.map((item: Record<string, unknown>) => {
            const file = item.file as
              | Record<string, Record<string, { url: string; width: number; height: number }>>
              | undefined;
            return {
              id: String(item.id),
              url: file?.hd?.gif?.url ?? file?.md?.gif?.url ?? '',
              preview: file?.sm?.gif?.url ?? file?.xs?.gif?.url ?? '',
              width: file?.sm?.gif?.width ?? 220,
              height: file?.sm?.gif?.height ?? 220,
            };
          });
          if (!query) gifCache.trending = results;
          else gifCache.searches[cacheKey] = results;
          renderGifs(results);
        } catch {
          gifGrid.innerHTML = '<div class="orkify-gif-empty">Failed to load GIFs</div>';
        }
      }

      gifSearch.addEventListener('input', () => {
        if (gifDebounce) clearTimeout(gifDebounce);
        gifDebounce = setTimeout(() => fetchGifs(gifSearch.value.trim()), 300);
      });

      const inputRow = document.createElement('div');
      inputRow.className = 'orkify-input-row';

      const textarea = document.createElement('textarea');
      textarea.className = 'orkify-input';
      textarea.placeholder = 'Write a message...';
      textarea.rows = 1;
      textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          if (pendingFile) {
            uploadFile(pendingFile);
          } else {
            sendMessage(textarea);
          }
        }
      });
      textarea.addEventListener('input', () => {
        textarea.style.height = 'auto';
        textarea.style.height = Math.min(textarea.scrollHeight, 80) + 'px';
      });

      const emojiBtn = document.createElement('button');
      emojiBtn.className = 'orkify-emoji-toggle';
      emojiBtn.innerHTML = ICON_EMOJI;
      emojiBtn.type = 'button';
      emojiBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        gifPopup.classList.remove('open');
        emojiPopup.classList.toggle('open');
      });

      const gifBtn = document.createElement('button');
      gifBtn.className = 'orkify-gif-toggle';
      gifBtn.innerHTML = ICON_GIF;
      gifBtn.type = 'button';
      gifBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        emojiPopup.classList.remove('open');
        const opening = !gifPopup.classList.contains('open');
        gifPopup.classList.toggle('open');
        if (opening) fetchGifs(gifSearch.value.trim());
      });

      // Close popups when clicking outside
      shadow.addEventListener('click', (e) => {
        const target = e.target as Node;
        if (!emojiPopup.contains(target) && target !== emojiBtn) {
          emojiPopup.classList.remove('open');
        }
        if (!gifPopup.contains(target) && target !== gifBtn) {
          gifPopup.classList.remove('open');
        }
      });

      // Hidden file input
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.style.display = 'none';
      fileInput.accept = Array.from(ALLOWED_FILE_TYPES).join(',');
      fileInput.addEventListener('change', () => {
        if (fileInput.files?.[0]) stageFile(fileInput.files[0]);
        fileInput.value = '';
      });

      const attachBtn = document.createElement('button');
      attachBtn.className = 'orkify-attach-toggle';
      attachBtn.innerHTML = ICON_ATTACH;
      attachBtn.type = 'button';
      attachBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        emojiPopup.classList.remove('open');
        gifPopup.classList.remove('open');
        fileInput.click();
      });

      function stageFile(file: File) {
        if (!ALLOWED_FILE_TYPES.has(file.type)) {
          alert('File type not supported');
          return;
        }
        if (file.size > MAX_FILE_SIZE) {
          alert('File too large (max 8 MB)');
          return;
        }
        pendingFile = file;
        showFilePreview(file);
      }

      function showFilePreview(file: File) {
        removeFilePreview();
        filePreviewEl = document.createElement('div');
        filePreviewEl.className = 'orkify-file-preview';

        if (file.type.startsWith('image/')) {
          const thumb = document.createElement('img');
          thumb.className = 'orkify-file-preview-thumb';
          thumb.src = URL.createObjectURL(file);
          thumb.alt = '';
          filePreviewEl.appendChild(thumb);
        } else {
          const iconEl = document.createElement('div');
          iconEl.className = 'orkify-file-preview-icon';
          iconEl.textContent = getFileIcon(file.type);
          filePreviewEl.appendChild(iconEl);
        }

        const infoEl = document.createElement('div');
        infoEl.className = 'orkify-file-preview-info';

        const nameEl = document.createElement('div');
        nameEl.className = 'orkify-file-preview-name';
        nameEl.textContent = file.name;
        infoEl.appendChild(nameEl);

        const sizeEl = document.createElement('div');
        sizeEl.className = 'orkify-file-preview-size';
        sizeEl.textContent = formatFileSize(file.size);
        infoEl.appendChild(sizeEl);

        filePreviewEl.appendChild(infoEl);

        const removeBtn = document.createElement('button');
        removeBtn.className = 'orkify-file-preview-remove';
        removeBtn.type = 'button';
        removeBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>`;
        removeBtn.addEventListener('click', () => {
          pendingFile = null;
          removeFilePreview();
        });
        filePreviewEl.appendChild(removeBtn);

        area.insertBefore(filePreviewEl, inputRow);
      }

      function removeFilePreview() {
        if (filePreviewEl) {
          // Revoke object URLs to free memory
          const thumb = filePreviewEl.querySelector(
            '.orkify-file-preview-thumb'
          ) as HTMLImageElement;
          if (thumb) URL.revokeObjectURL(thumb.src);
          filePreviewEl.remove();
          filePreviewEl = null;
        }
      }

      // Drag-and-drop on the panel
      let dragCounter = 0;
      panel.addEventListener('dragenter', (e) => {
        e.preventDefault();
        dragCounter++;
        panel.classList.add('orkify-dragover');
      });
      panel.addEventListener('dragleave', () => {
        dragCounter--;
        if (dragCounter <= 0) {
          dragCounter = 0;
          panel.classList.remove('orkify-dragover');
        }
      });
      panel.addEventListener('dragover', (e) => {
        e.preventDefault();
      });
      panel.addEventListener('drop', (e) => {
        e.preventDefault();
        dragCounter = 0;
        panel.classList.remove('orkify-dragover');
        const file = e.dataTransfer?.files[0];
        if (file) stageFile(file);
      });

      const sendBtn = document.createElement('button');
      sendBtn.className = 'orkify-send';
      sendBtn.innerHTML = ICON_SEND;
      sendBtn.addEventListener('click', () => {
        if (pendingFile) {
          uploadFile(pendingFile);
        } else {
          sendMessage(textarea);
        }
      });

      const inputActions = document.createElement('div');
      inputActions.className = 'orkify-input-actions';

      inputActions.appendChild(attachBtn);
      inputActions.appendChild(emojiBtn);
      if (klipyKey) inputActions.appendChild(gifBtn);
      inputActions.appendChild(sendBtn);

      inputRow.appendChild(textarea);
      inputRow.appendChild(inputActions);
      area.appendChild(fileInput);
      area.appendChild(emojiPopup);
      if (klipyKey) area.appendChild(gifPopup);
      area.appendChild(inputRow);
      panel.insertBefore(area, panel.querySelector('.orkify-powered'));
    }

    function scrollToBottom() {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          messagesEl.scrollTop = messagesEl.scrollHeight;
        });
      });
    }

    function toggle() {
      // Detect auth state change (SPA navigation after login/logout)
      const currentVisitor = (window as unknown as Record<string, unknown>).__orkify_visitor as
        | null
        | undefined
        | { email?: string };
      const currentEmail = currentVisitor?.email || '';
      if (currentEmail !== presetEmail) {
        // Tear down and reinitialize with new visitor context
        if (eventSource) eventSource.close();
        if (sseReconnectTimer) clearTimeout(sseReconnectTimer);
        host.remove();
        initWidget(true);
        return;
      }

      isOpen = !isOpen;
      panel.classList.toggle('open', isOpen);
      launcher.classList.toggle('open', isOpen);
      if (isOpen) {
        launcher.classList.remove('orkify-has-unread');
        ensureSession();
        scrollToBottom();
      }
    }

    function appendMessage(msg: ChatMessage): HTMLDivElement {
      // Track last support agent for presence indicator
      updatePresence(msg);

      // Show unread indicator when support replies while panel is closed
      if (!isOpen && msg.isBot) {
        launcher.classList.add('orkify-has-unread');
      }

      // Remove greeting if present
      const greeting = messagesEl.querySelector('.orkify-greeting');
      if (greeting) greeting.remove();

      const wrapper = document.createElement('div');
      wrapper.className = `orkify-msg ${msg.isBot ? 'orkify-msg-support' : 'orkify-msg-visitor'}`;

      // For support messages: avatar sits outside the bubble
      let bubble: HTMLElement = wrapper;
      if (msg.isBot) {
        if (msg.avatar) {
          const avatarEl = document.createElement('img');
          avatarEl.className = 'orkify-msg-avatar';
          avatarEl.src = msg.avatar;
          avatarEl.alt = '';
          wrapper.appendChild(avatarEl);
        }
        bubble = document.createElement('div');
        bubble.className = 'orkify-msg-bubble';
        const authorEl = document.createElement('div');
        authorEl.className = 'orkify-msg-author';
        authorEl.textContent = msg.author;
        bubble.appendChild(authorEl);
        wrapper.appendChild(bubble);
      }

      if (msg.content) {
        const content = document.createElement('div');
        content.textContent = msg.content;
        bubble.appendChild(content);
      }

      if (msg.attachments) {
        for (const att of msg.attachments) {
          if (att.contentType === 'application/json+lottie') {
            const container = document.createElement('div');
            container.className = 'orkify-msg-image orkify-lottie';
            container.style.width = '200px';
            container.style.height = '200px';
            bubble.appendChild(container);

            // Decode base64 data URI and render first frame
            loadLottie()
              .then((lottie) => {
                const base64 = att.url.split(',')[1];
                const json = JSON.parse(atob(base64));
                lottie.loadAnimation({
                  container,
                  renderer: 'svg',
                  loop: true,
                  autoplay: true,
                  animationData: json,
                });
              })
              .catch(() => {
                container.textContent = '(sticker)';
              });
          } else if (att.contentType.startsWith('image/')) {
            const imgWrap = document.createElement('div');
            imgWrap.className = 'orkify-img-wrap';

            const img = document.createElement('img');
            img.className = 'orkify-msg-image';
            img.src = att.url;
            img.alt = att.filename;
            img.loading = 'lazy';
            img.addEventListener('load', scrollToBottom);
            imgWrap.appendChild(img);

            const imgActions = document.createElement('div');
            imgActions.className = 'orkify-img-actions';

            const expandBtn = document.createElement('button');
            expandBtn.className = 'orkify-img-btn';
            expandBtn.type = 'button';
            expandBtn.title = 'View full size';
            expandBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`;
            expandBtn.addEventListener('click', () => showLightbox(att.url));

            const dlBtn = document.createElement('button');
            dlBtn.className = 'orkify-img-btn';
            dlBtn.type = 'button';
            dlBtn.title = 'Download';
            dlBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
            dlBtn.addEventListener('click', async () => {
              try {
                const res = await fetch(att.url);
                const blob = await res.blob();
                const blobUrl = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = blobUrl;
                a.download = att.filename;
                a.click();
                URL.revokeObjectURL(blobUrl);
              } catch {
                window.open(att.url, '_blank');
              }
            });

            imgActions.appendChild(expandBtn);
            imgActions.appendChild(dlBtn);
            imgWrap.appendChild(imgActions);
            bubble.appendChild(imgWrap);
          } else {
            const card = document.createElement('a');
            card.className = 'orkify-file-card';
            card.href = att.url;
            card.target = '_blank';
            card.rel = 'noopener';

            const icon = document.createElement('span');
            icon.className = 'orkify-file-card-icon';
            icon.textContent = getFileIcon(att.contentType);
            card.appendChild(icon);

            const info = document.createElement('div');
            info.className = 'orkify-file-card-info';

            const name = document.createElement('div');
            name.className = 'orkify-file-card-name';
            name.textContent = att.filename;
            info.appendChild(name);

            if (att.size > 0) {
              const size = document.createElement('div');
              size.className = 'orkify-file-card-size';
              size.textContent = formatFileSize(att.size);
              info.appendChild(size);
            }

            card.appendChild(info);
            bubble.appendChild(card);
          }
        }
      }

      const time = document.createElement('div');
      time.className = 'orkify-msg-time';
      time.textContent = new Date(msg.timestamp).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      });
      bubble.appendChild(time);

      messagesEl.appendChild(wrapper);
      messagesEl.scrollTop = messagesEl.scrollHeight;
      return wrapper;
    }

    function clearFailed(wrapper: HTMLDivElement) {
      wrapper.classList.remove('orkify-msg-failed');
      const errorRow = wrapper.querySelector('.orkify-msg-error');
      if (errorRow) errorRow.remove();
    }

    function markFailed(wrapper: HTMLDivElement, retry: () => void) {
      wrapper.classList.add('orkify-msg-failed');
      // Don't duplicate if already marked
      if (wrapper.querySelector('.orkify-msg-error')) return;

      const row = document.createElement('div');
      row.className = 'orkify-msg-error';
      row.textContent = '\u26A0 Failed to send \u00B7 ';

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'Tap to retry';
      btn.addEventListener('click', () => {
        clearFailed(wrapper);
        retry();
      });

      row.appendChild(btn);
      wrapper.appendChild(row);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    async function sendGif(url: string) {
      if (isSending) return;
      isSending = true;

      const wrapper = appendMessage({
        content: '',
        attachments: [{ url, filename: 'gif', contentType: 'image/gif', size: 0 }],
        author: visitorName,
        timestamp: new Date().toISOString(),
        isBot: false,
      });

      try {
        const res = await fetch(`${baseUrl}/api/chat/send?widgetKey=${widgetKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ widgetKey, message: url, threadId, visitorName, visitorEmail }),
        });

        if (!res.ok) throw new Error('Send failed');
        const data = await res.json();

        if (data.threadId && data.threadId !== threadId) {
          threadId = data.threadId;
          localStorage.setItem(`${storageId}_thread`, data.threadId);
          connectSSE();
        }
      } catch (e) {
        console.error('[Orkify Chat] Send GIF error:', e);
        markFailed(wrapper, () => sendGif(url));
      } finally {
        isSending = false;
      }
    }

    async function retrySendMessage(message: string, wrapper: HTMLDivElement) {
      if (isSending) return;
      isSending = true;

      try {
        const res = await fetch(`${baseUrl}/api/chat/send?widgetKey=${widgetKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ widgetKey, message, threadId, visitorName, visitorEmail }),
        });

        if (!res.ok) throw new Error('Send failed');
        const data = await res.json();

        if (data.threadId && data.threadId !== threadId) {
          threadId = data.threadId;
          localStorage.setItem(`${storageId}_thread`, data.threadId);
          connectSSE();
        }
      } catch (e) {
        console.error('[Orkify Chat] Send error:', e);
        markFailed(wrapper, () => retrySendMessage(message, wrapper));
      } finally {
        isSending = false;
      }
    }

    async function sendMessage(textarea: HTMLTextAreaElement) {
      const message = textarea.value.trim();
      if (!message || isSending) return;

      isSending = true;
      textarea.value = '';
      textarea.style.height = 'auto';

      const wrapper = appendMessage({
        content: message,
        author: visitorName,
        timestamp: new Date().toISOString(),
        isBot: false,
      });

      try {
        const res = await fetch(`${baseUrl}/api/chat/send?widgetKey=${widgetKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ widgetKey, message, threadId, visitorName, visitorEmail }),
        });

        if (!res.ok) throw new Error('Send failed');
        const data = await res.json();

        if (data.threadId && data.threadId !== threadId) {
          threadId = data.threadId;
          localStorage.setItem(`${storageId}_thread`, data.threadId);
          connectSSE();
        }
      } catch (e) {
        console.error('[Orkify Chat] Send error:', e);
        markFailed(wrapper, () => retrySendMessage(message, wrapper));
      } finally {
        isSending = false;
      }
    }

    async function retryUploadFile(file: File, wrapper: HTMLDivElement) {
      if (isSending) return;
      isSending = true;

      try {
        const form = new FormData();
        form.append('file', file);
        if (widgetKey) form.append('widgetKey', widgetKey);
        form.append('visitorName', visitorName);
        form.append('visitorEmail', visitorEmail);
        if (threadId) form.append('threadId', threadId);

        const res = await fetch(`${baseUrl}/api/chat/upload?widgetKey=${widgetKey}`, {
          method: 'POST',
          body: form,
        });

        if (!res.ok) throw new Error('Upload failed');
        const data = await res.json();

        if (data.threadId && data.threadId !== threadId) {
          threadId = data.threadId;
          localStorage.setItem(`${storageId}_thread`, data.threadId);
          connectSSE();
        }
      } catch (e) {
        console.error('[Orkify Chat] Upload error:', e);
        markFailed(wrapper, () => retryUploadFile(file, wrapper));
      } finally {
        isSending = false;
      }
    }

    async function uploadFile(file: File) {
      if (isSending) return;
      isSending = true;

      // Optimistic: show file in chat immediately
      const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : '';
      const wrapper = appendMessage({
        content: '',
        attachments: [
          {
            url: previewUrl,
            filename: file.name,
            contentType: file.type,
            size: file.size,
          },
        ],
        author: visitorName,
        timestamp: new Date().toISOString(),
        isBot: false,
      });

      pendingFile = null;
      // removeFilePreview is scoped in renderInputArea — clear DOM directly
      if (filePreviewEl) {
        const thumb = filePreviewEl.querySelector('.orkify-file-preview-thumb') as HTMLImageElement;
        if (thumb) URL.revokeObjectURL(thumb.src);
        filePreviewEl.remove();
        filePreviewEl = null;
      }

      try {
        const form = new FormData();
        form.append('file', file);
        if (widgetKey) form.append('widgetKey', widgetKey);
        form.append('visitorName', visitorName);
        form.append('visitorEmail', visitorEmail);
        if (threadId) form.append('threadId', threadId);

        const res = await fetch(`${baseUrl}/api/chat/upload?widgetKey=${widgetKey}`, {
          method: 'POST',
          body: form,
        });

        if (!res.ok) throw new Error('Upload failed');
        const data = await res.json();

        if (data.threadId && data.threadId !== threadId) {
          threadId = data.threadId;
          localStorage.setItem(`${storageId}_thread`, data.threadId);
          connectSSE();
        }
      } catch (e) {
        console.error('[Orkify Chat] Upload error:', e);
        markFailed(wrapper, () => retryUploadFile(file, wrapper));
      } finally {
        isSending = false;
        if (previewUrl) URL.revokeObjectURL(previewUrl);
      }
    }

    function connectSSE() {
      if (!threadId) return;
      if (eventSource) eventSource.close();
      if (sseReconnectTimer) {
        clearTimeout(sseReconnectTimer);
        sseReconnectTimer = null;
      }

      eventSource = new EventSource(
        `${baseUrl}/api/chat/stream?widgetKey=${widgetKey}&threadId=${threadId}`
      );

      eventSource.onopen = () => {
        sseBackoff = 1000;
      };

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'message') appendMessage(data);
        } catch {
          /* ignore */
        }
      };

      eventSource.onerror = () => {
        if (eventSource) {
          eventSource.close();
          eventSource = null;
        }
        console.warn(`[Orkify Chat] SSE error, reconnecting in ${sseBackoff / 1000}s`);
        sseReconnectTimer = setTimeout(() => {
          sseReconnectTimer = null;
          connectSSE();
        }, sseBackoff);
        sseBackoff = Math.min(sseBackoff * 2, SSE_BACKOFF_MAX);
      };
    }

    async function loadHistory() {
      if (!threadId) return;
      try {
        const res = await fetch(
          `${baseUrl}/api/chat/history?widgetKey=${widgetKey}&threadId=${threadId}`
        );
        if (!res.ok) {
          if (res.status === 404) {
            threadId = null;
            localStorage.removeItem(`${storageId}_thread`);
          }
          return;
        }
        const data = await res.json();
        const loader = messagesEl.querySelector('.orkify-loading');
        if (loader) loader.remove();

        if (data.messages) {
          for (const msg of data.messages) appendMessage(msg);
          scrollToBottom();
        }
      } catch (e) {
        console.error('[Orkify Chat] History error:', e);
        throw e; // Propagate so ensureSession can retry
      }
    }

    // Cleanup on page unload
    window.addEventListener('beforeunload', () => {
      if (eventSource) eventSource.close();
      if (sseReconnectTimer) clearTimeout(sseReconnectTimer);
      if (presenceTimer) clearInterval(presenceTimer);
      themeObserver.disconnect();
    });

    init();
  } // end initWidget
})();
