# Depsight

Dependency-health analysis for the MoonBit ecosystem. Depsight turns a single `moon.mod` into a health report: a full dependency graph, license and freshness signals, and AI-assisted fixes — surfacing risky dependencies before they reach production.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![MoonBit](https://img.shields.io/badge/engine-MoonBit%20wasm--gc-orange)](https://www.moonbitlang.com/)
[![mooncakes](https://img.shields.io/badge/mooncakes-Tino--hue%2Fdepsight--wasm--api-blue)](https://mooncakes.io/docs/#/Tino-hue/depsight-wasm-api)
[![Online](https://img.shields.io/badge/live%20demo-depsight.xruoyu.xyz-brightgreen)](https://depsight.xruoyu.xyz/)

**Live demo: [depsight.xruoyu.xyz](https://depsight.xruoyu.xyz/)**

![Depsight landing page](./docs/images/hero.png)

## Feature tour

### Dependency analysis & health scoring

Paste a `moon.mod`, upload a file, or type `name@version`: Depsight expands the full transitive dependency graph and scores it 0–100 across five weighted dimensions. Every finding carries a diagnostic ID (`OUTDATED` / `LICENSE` / `DEPRECATED` / `SIZE` / `ACTIVITY` / `CYCLE` / `DUP` / `YANKED`) plus a concrete fix suggestion.

| Dimension              | Weight | Signal                                     |
| ---------------------- | ------ | ------------------------------------------ |
| Freshness              | 25%    | Gap to the latest published version        |
| Deprecated-API density | 25%    | Deprecated APIs referenced per package     |
| License compliance     | 20%    | SPDX validity, copyleft / unlicensed flags |
| Package size           | 20%    | Self and transitive footprint              |
| Activity               | 10%    | Days since the last upstream commit        |

![Analysis dashboard](./docs/images/analyze.png)

### 3D dependency graph

A three.js force-directed layout where node size encodes package footprint and color encodes health score (green → red). Supports search-to-focus, dependency-path highlighting, and one-click reset.

![3D dependency graph](./docs/images/graph.png)

### Trend tracking

Every analysis appends the health score to local history. A hand-drawn Canvas line chart shows the score over time, with multi-root comparison.

![Health score trends](./docs/images/trends.png)

### Ecosystem dashboard

Pulls the full mooncakes.io package catalog (direct network access required) and aggregates ecosystem health, active/stale split, license composition, and risk-type counts.

![Ecosystem dashboard](./docs/images/ecosystem.png)

### More capabilities

| Capability          | Description                                                                                                                             |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| AI diagnostics      | Any OpenAI-compatible API: single-risk diagnosis, full report, or fix-PR draft; falls back to a built-in rule engine without an API key |
| Shareable results   | Results are compressed into a `#share=<payload>` URL; recipients restore the full view without re-analysis                              |
| Local history       | The last 20 analyses persist in localStorage across reloads                                                                             |
| Engine status badge | The header badge shows the live engine state (WASM ✓ / JS fallback / circuit-open)                                                      |

## Architecture: isomorphic dual engine

The core analysis engine is written in **MoonBit** and compiled to **WASM** (`wasm-gc` target + JS string builtins). A line-by-line aligned **TypeScript fallback** ships alongside and takes over automatically when WASM is unavailable, with identical behavior.

```
┌────────────────────────────────────────────┐
│  React 19 + TypeScript + Vite + Tailwind   │
│  three.js — 3D visualization               │
├────────────────────────────────────────────┤
│  MoonBit WASM engine      TS fallback      │
│  moonbit/main/*.mbt  <->  src/lib/analyzer.ts │
│  (contract tests assert field-level parity)│
├────────────────────────────────────────────┤
│  Vercel Serverless: /api/download/*, /api/health │
├────────────────────────────────────────────┤
│  mooncakes.io API (open CORS, browser-direct) │
└────────────────────────────────────────────┘
```

Engine reliability mechanisms:

- **`version()` contract gate** — WASM is disabled automatically when the version declared by the frontend mismatches the one built into the module;
- **Circuit breaker** — three consecutive engine failures degrade to the TS implementation;
- **Oversized-input guard** — analysis contexts above 8 MB bypass WASM and run in TS directly;
- **Dual-engine contract tests** — `moon test` (47 cases) and vitest (77 cases) assert identical outputs for the same inputs.

## Repository layout

```
depsight-web/   # Web app (React 19 + TS + Vite + Vercel Serverless)
moonbit/        # MoonBit WASM analysis engine (published on mooncakes.io)
docs/images/    # Product screenshots
Makefile        # Builds the WASM artifact and syncs it into moonbit/ and depsight-web/public/
```

## Quick start

### Web app

```bash
cd depsight-web
npm install
npm run dev        # local dev server (port 5173 by default)
npm run build      # production build
npm test           # unit tests (vitest)
```

### MoonBit engine

```bash
# Requires the MoonBit toolchain: https://www.moonbitlang.com/
make wasm                # build the wasm-gc artifact and sync it into moonbit/ and depsight-web/public/
cd moonbit && moon test  # engine unit tests
```

## Contributing

Issues and pull requests are welcome. For non-trivial changes, open an issue first to align on scope. Any engine change must keep the MoonBit implementation and the TypeScript fallback in lockstep — the dual-engine contract tests have to pass on both sides.

## Links

- Web app deep dive: [depsight-web/README.md](./depsight-web/README.md)
- Delivery notes: [depsight-web/DELIVERY.md](./depsight-web/DELIVERY.md)
- MoonBit package: [Tino-hue/depsight-wasm-api](https://mooncakes.io/docs/#/Tino-hue/depsight-wasm-api)
- License: MIT (see [LICENSE](./LICENSE))
