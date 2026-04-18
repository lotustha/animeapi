# Cooren API

[![Bun](https://img.shields.io/badge/Bun-%23000000.svg?style=for-the-badge&logo=bun&logoColor=white)](https://bun.sh)
[![Node.js](https://img.shields.io/badge/Node.js-339933.svg?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![Deno](https://img.shields.io/badge/Deno-000000.svg?style=for-the-badge&logo=deno&logoColor=white)](https://deno.land)
[![ElysiaJS](https://img.shields.io/badge/ElysiaJS-%23FEEB00.svg?style=for-the-badge&logo=elysiajs&logoColor=black)](https://elysiajs.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-%23007ACC.svg?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg?style=for-the-badge)](LICENSE)


Cooren is an open-source, high-performance, and scalable scraping engine designed to collect, organize, and deliver structured data from across the world of anime, movies, manga, and music.

Developed and maintained by [CoorenLabs](https://coorenlabs.com).

---

## Quick Links

- [Website](https://coorenlabs.com)
- [Documentation](https://docs.coorenlabs.com)
- [GitHub](https://github.com/CoorenLabs/CoorenLabs)

---

## Features

- **Multi-Runtime Compliance**: Full support for Bun, Node.js, and Deno.
- **Unified Media Ecosystem**: Anime, Manga, Movies, TV, and Music.
- **High Performance**: Native speed powered by Bun and ElysiaJS.
- **Mock-Based Testing**: Comprehensive dual-framework (Vitest/Jest) integration tests.
- **Developer Friendly**: TypeScript and modular, test-ready architecture.


---

## Tech Stack

- **Runtime**: Bun
- **Framework**: ElysiaJS
- **Language**: TypeScript
- **Scraping**: Cheerio, Puppeteer
- **Database/Cache**: Upstash Redis
- **Validation**: Zod

---

## Getting Started

### Prerequisites

Install [Bun](https://bun.sh).

### Installation

```bash
git clone https://github.com/CoorenLabs/CoorenLabs.git
cd CoorenLabs
bun install
```

### Running the Server

```bash
bun run dev      # or bun run hot
```

### Build for Production

```bash
bun run build:bun   # Optimized for Bun
bun run build:node  # Compile to Node
```

---

## Creating a New Provider

```
src/providers/<name>/
├── route.ts
├── <name>.ts
└── types.ts
```

### Example: route.ts

```ts
import Elysia from "elysia";
import { FlixHQ } from "./flixhq";

export const flixhqRoutes = new Elysia({ prefix: "/flixhq" })
  .get("/home", async () => await FlixHQ.home())
  .get("/search/:query", async ({ params: { query } }) => await FlixHQ.search(query));
```

---

## Testing & Linting

```bash
bun run test
bun run lint
bun run lint:fix
```

---

## License

This project is licensed under the [GPL-3.0 License](LICENSE).

---
