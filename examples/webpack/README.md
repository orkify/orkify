# Webpack Example

A minimal HTTP server bundled with webpack. Used to test source map resolution
for errors from webpack-bundled code.

## Setup

```bash
npm install
npm run build
```

## Run with orkify

```bash
orkify up dist/server.js -n webpack-example
```

## Trigger errors

```bash
curl http://localhost:4200/throw    # Uncaught exception
curl http://localhost:4200/reject   # Unhandled rejection
```

Errors should appear in the orkify dashboard with original TypeScript source
locations (not minified `dist/server.js` locations).
