# Mugen

[![Bun](https://img.shields.io/badge/Bun-%23000000.svg?style=for-the-badge&logo=bun&logoColor=white)](https://bun.sh)
[![Node.js](https://img.shields.io/badge/Node.js-339933.svg?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![Deno](https://img.shields.io/badge/Deno-000000.svg?style=for-the-badge&logo=deno&logoColor=white)](https://deno.land)
[![ElysiaJS](https://img.shields.io/badge/ElysiaJS-%23FEEB00.svg?style=for-the-badge&logo=elysiajs&logoColor=black)](https://elysiajs.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-%23007ACC.svg?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg?style=for-the-badge)](LICENSE)

**Mugen** is a high-performance, developer-focused media scraping engine. Engineered for scalability and speed, it provides a unified ecosystem for aggregating, structuring, and serving media data across various domains, including Anime, Manga, Movies, TV Shows, and Music. 

---

## Technical Overview

Mugen leverages a modern JavaScript runtime environment to deliver exceptional performance and low latency. It is architected to be modular, making it easy to extend and maintain across diverse scraping providers.

### Key Features
- **Multi-Runtime Compatibility**: Engineered to run seamlessly across Bun, Node.js, and Deno environments.
- **Unified Media Aggregation**: A single, cohesive API capable of handling multiple media types simultaneously.
- **Native Execution Speed**: Powered by the Bun runtime and the ElysiaJS framework for unparalleled throughput.
- **Robust Testing Infrastructure**: Features comprehensive integration testing utilizing both Vitest and Jest, complete with advanced mock implementations.
- **Developer-Centric Design**: Written entirely in TypeScript, emphasizing type safety, modular design, and robust developer ergonomics.

---

## Technology Stack

- **Primary Runtime**: [Bun](https://bun.sh)
- **Web Framework**: [ElysiaJS](https://elysiajs.com)
- **Language**: TypeScript
- **Data Parsing & Scraping**: Cheerio, Puppeteer
- **Caching & Storage**: Upstash Redis
- **Schema Validation**: Zod

---

## Getting Started

### Prerequisites

Before running the project locally, ensure you have [Bun](https://bun.sh) installed on your system.

### Installation

Clone the repository and install the required dependencies:

```bash
git clone https://github.com/lotustha/animeapi.git
cd animeapi
bun install
```

### Running the Development Server

To launch the API in a local development environment:

```bash
bun run dev
```

*Alternatively, you can utilize hot-reloading with `bun run hot`.*

### Building for Production

Mugen offers dedicated build pipelines tailored to your deployment environment:

```bash
bun run build:bun   # Highly optimized bundle for the Bun runtime
bun run build:node  # Standard ES compilation for Node.js environments
```

---

## Extending the Engine

Mugen is built to be easily extensible. To create a new data provider, structure your module using the following convention within the `src/providers` directory:

```text
src/providers/<namespace>/
├── route.ts
├── <name>.ts
└── types.ts
```

### Route Registration Example (`route.ts`)

```ts
import Elysia from "elysia";
import { FlixHQ } from "./flixhq";

export const flixhqRoutes = new Elysia({ prefix: "/flixhq" })
  .get("/home", async () => await FlixHQ.home())
  .get("/search/:query", async ({ params: { query } }) => await FlixHQ.search(query));
```

---

## Development & Maintenance

Maintain code quality by utilizing the built-in testing and linting pipelines:

```bash
# Execute the test suite
bun run test

# Run ESLint compliance checks
bun run lint

# Automatically resolve fixable linting issues
bun run lint:fix
```

---

## License

This software is distributed under the [GPL-3.0 License](LICENSE). For more information, please see the `LICENSE` file in the project repository.
