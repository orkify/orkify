'use client';

import { useEffect, useRef } from 'react';

interface OrkifyChatProps {
  /** Widget key from the orkify Integrations settings page. */
  widgetKey: string;
  /** Visitor's display name. Skips the intro form when provided with email. */
  visitorName?: string;
  /** Visitor's email. Used for thread identification and cross-browser restoration. */
  visitorEmail?: string;
  /** HMAC-SHA256 hex digest of the email. Enables identity verification. */
  visitorHash?: string;
  /** Klipy API key to enable the GIF picker. */
  klipyKey?: string;
  /**
   * URL of the chat widget script.
   * Defaults to the jsDelivr CDN-hosted version.
   */
  src?: string;
}

/**
 * Embeddable support chat widget for orkify.
 *
 * Drop this component into your root layout to add live chat powered by
 * Discord. Messages are routed through orkify and delivered to your Discord
 * channel as threads.
 *
 * @example
 * ```tsx
 * // app/layout.tsx
 * import { OrkifyChat } from '@orkify/chat/react';
 *
 * export default function Layout({ children }) {
 *   return (
 *     <html>
 *       <body>
 *         {children}
 *         <OrkifyChat widgetKey="wk_..." />
 *       </body>
 *     </html>
 *   );
 * }
 * ```
 *
 * @example With visitor info (skip intro form)
 * ```tsx
 * <OrkifyChat
 *   widgetKey="wk_..."
 *   visitorName={user.name}
 *   visitorEmail={user.email}
 *   visitorHash={hmac}
 * />
 * ```
 */
export function OrkifyChat({
  widgetKey,
  visitorName,
  visitorEmail,
  visitorHash,
  klipyKey,
  src = 'https://cdn.jsdelivr.net/npm/@orkify/chat/orkify-chat.js',
}: OrkifyChatProps) {
  const loadedRef = useRef(false);

  // Keep window.__orkify_visitor in sync across SPA navigations.
  // Only set when visitor props are provided — nested layouts can override
  // via their own VisitorSignal or OrkifyChat with visitor props.
  useEffect(() => {
    if (visitorName && visitorEmail) {
      (window as unknown as Record<string, unknown>).__orkify_visitor = {
        name: visitorName,
        email: visitorEmail,
        ...(visitorHash && { hash: visitorHash }),
      };
      return () => {
        (window as unknown as Record<string, unknown>).__orkify_visitor = null;
      };
    }
  }, [visitorName, visitorEmail, visitorHash]);

  // Load the widget script once
  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;

    const script = document.createElement('script');
    script.src = src;
    script.defer = true;
    script.dataset.widgetKey = widgetKey;
    if (klipyKey) script.dataset.klipyKey = klipyKey;
    document.body.appendChild(script);
  }, [src, widgetKey, klipyKey]);

  return null;
}
