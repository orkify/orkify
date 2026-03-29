<h1><img src="../../assets/icon.png" alt="" width="36" align="center" /> @orkify/chat</h1>

[![Beta](https://img.shields.io/badge/status-beta-yellow)](https://github.com/orkify/orkify)
[![CI](https://github.com/orkify/orkify/actions/workflows/ci.yml/badge.svg)](https://github.com/orkify/orkify/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@orkify/chat)](https://www.npmjs.com/package/@orkify/chat)
[![Node](https://img.shields.io/node/v/@orkify/chat)](https://nodejs.org/)
[![License](https://img.shields.io/npm/l/@orkify/chat)](https://github.com/orkify/orkify/blob/main/LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-%E2%89%A55.9-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

Embeddable support chat widget that lets you talk to your website visitors in real time — directly from Discord. Add it to any website with a single script tag or a React component.

Visitor messages are routed through [orkify](https://orkify.com) and delivered to your Discord channel as threads. Your team replies in Discord, visitors see responses in the widget instantly. Requires an [orkify account](https://orkify.com/signup) with a paid plan and a Discord bot connected via the dashboard. See the [full setup guide](https://orkify.com/docs/discord-support-chat) for details.

## Table of Contents

- [Installation](#installation)
- [Script Tag (any website)](#script-tag-any-website)
- [React / Next.js Component](#react--nextjs-component)
- [Visitor Identity](#visitor-identity)
- [Identity Verification (HMAC)](#identity-verification-hmac)
- [GIFs & Stickers](#gifs--stickers)
- [Widget Attributes](#widget-attributes)
- [Requirements](#requirements)
- [License](#license)

## Installation

```bash
npm install @orkify/chat
```

Or skip the install and use a CDN — no npm required:

```html
<script
  src="https://cdn.jsdelivr.net/npm/@orkify/chat/orkify-chat.js"
  data-widget-key="YOUR_KEY"
></script>
```

## Script Tag (any website)

Works on any website — no framework required. Add a single script tag before `</body>`:

### CDN (recommended)

Served directly from npm via jsDelivr or unpkg — always up to date, no hosting needed:

```html
<script
  src="https://cdn.jsdelivr.net/npm/@orkify/chat/orkify-chat.js"
  data-widget-key="YOUR_KEY"
></script>
```

Or pin to a specific version:

```html
<script
  src="https://cdn.jsdelivr.net/npm/@orkify/chat@1.0.0-beta.8/orkify-chat.js"
  data-widget-key="YOUR_KEY"
></script>
```

### Self-hosted

Copy the widget script to your site and reference it locally:

```bash
cp node_modules/@orkify/chat/orkify-chat.js public/
```

```html
<script src="/orkify-chat.js" data-widget-key="YOUR_KEY"></script>
```

## React / Next.js Component

For Next.js and React apps, use the `<OrkifyChat>` component. It handles script loading, visitor context, and SPA navigation automatically.

```bash
npm install @orkify/chat
```

Add it to your root layout:

```tsx
// app/layout.tsx
import { OrkifyChat } from '@orkify/chat/react';

export default function Layout({ children }) {
  return (
    <html>
      <body>
        {children}
        <OrkifyChat widgetKey="wk_..." />
      </body>
    </html>
  );
}
```

### With visitor info

Pass visitor props to skip the intro form and enable cross-browser chat restoration:

```tsx
<OrkifyChat
  widgetKey="wk_..."
  visitorName={user.name}
  visitorEmail={user.email}
  visitorHash={hmac}
/>
```

### Self-hosted script

By default the component loads the script from jsDelivr CDN. To self-host:

```tsx
<OrkifyChat widgetKey="wk_..." src="/orkify-chat.js" />
```

## Visitor Identity

There are three levels of integration:

| Level                      | What happens                                                                   |
| -------------------------- | ------------------------------------------------------------------------------ |
| **Anonymous**              | Visitors fill out a name + email form before chatting                          |
| **With user info**         | Pass `visitorName` + `visitorEmail` to skip the form                           |
| **With HMAC verification** | Add `visitorHash` for identity verification and cross-browser chat restoration |

## Identity Verification (HMAC)

HMAC-SHA256 verification proves the visitor's email was set by your server, preventing impersonation and enabling cross-browser chat restoration.

Compute `HMAC-SHA256(email, signingSecret)` on your server and pass the hex string as `visitorHash` (React) or `data-visitor-hash` (script tag).

```javascript
// Server-side (Node.js)
const crypto = require('crypto');
const hash = crypto.createHmac('sha256', SIGNING_SECRET).update(user.email).digest('hex');
```

Your signing secret is on the **Integrations** settings page in the orkify dashboard. Never expose it in client-side code.

## GIFs & Stickers

### GIFs

Visitors can send GIFs using the built-in picker, powered by [Klipy](https://klipy.co). Pass your Klipy API key:

```tsx
<OrkifyChat widgetKey="wk_..." klipyKey="klipy_..." />
```

Or with the script tag:

```html
<script
  src="https://cdn.jsdelivr.net/npm/@orkify/chat/orkify-chat.js"
  data-widget-key="YOUR_KEY"
  data-klipy-key="klipy_..."
></script>
```

GIFs sent from Discord are displayed in the widget automatically.

### Stickers

Discord stickers sent by your team are rendered with full animation support. Animated stickers (Lottie format) play as smooth animations using lottie-web, loaded on demand. No configuration needed.

## Widget Attributes

For the script tag integration:

| Attribute            | Required | Description                                                           |
| -------------------- | -------- | --------------------------------------------------------------------- |
| `data-widget-key`    | Yes      | Widget key from the orkify Integrations settings page                 |
| `data-visitor-name`  | No       | Visitor's display name. Skips the intro form when provided with email |
| `data-visitor-email` | No       | Visitor's email. Used for thread identification                       |
| `data-visitor-hash`  | No       | HMAC-SHA256 hex digest for identity verification                      |
| `data-klipy-key`     | No       | Klipy API key to enable the GIF picker                                |

## Requirements

- An [orkify](https://orkify.com) account with a paid plan
- A Discord bot connected via the orkify dashboard (see the [setup guide](https://orkify.com/docs/discord-support-chat))
- For the React component: React 18+ and Next.js 15+
- Messages are routed through [orkify.com](https://orkify.com) — no self-hosted backend needed

## License

Apache-2.0
