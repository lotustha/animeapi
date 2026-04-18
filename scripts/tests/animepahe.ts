const BASE_URL = process.env.API_BASE_URL || process.env.SERVER_ORIGIN || "http://localhost:3000";
const PROVIDER = "animepahe";

interface TestResult {
  name: string;
  endpoint: string;
  status: number;
  responseTime: number;
  success: boolean;
  error?: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

let globalApp: any = null;

async function requestJson(endpoint: string): Promise<{ status: number; data: unknown; responseTime: number }> {
  const startedAt = Date.now();
  let status: number;
  let data: unknown;

  if (globalApp) {
    const url = `${BASE_URL}${endpoint}`;
    const response = await globalApp.handle(new Request(url));
    status = response.status;
    try {
      data = await response.json();
    } catch {
      data = { error: "Failed to parse JSON" };
    }
  } else {
    const response = await fetch(`${BASE_URL}${endpoint}`);
    status = response.status;
    try {
      data = await response.json();
    } catch {
      data = { error: "Failed to parse JSON" };
    }
  }

  const responseTime = Date.now() - startedAt;
  return { status, data, responseTime };
}

async function runTest(
  name: string,
  endpoint: string,
  validate: (data: unknown) => boolean,
  expectedStatus = 200,
): Promise<TestResult> {
  try {
    const { status, data, responseTime } = await requestJson(endpoint);
    const statusOk = status === expectedStatus;
    const shapeOk = statusOk ? validate(data) : false;

    return {
      name,
      endpoint,
      status,
      responseTime,
      success: statusOk && shapeOk,
      error: statusOk && shapeOk ? undefined : `Unexpected response for ${endpoint}`,
    };
  } catch (error) {
    return {
      name,
      endpoint,
      status: 0,
      responseTime: 0,
      success: false,
      error: String(error),
    };
  }
}

export async function runAnimePaheTests(app?: any): Promise<void> {
  globalApp = app;
  console.log("🧪 Running unified anime API tests (AnimePahe provider)");
  if (globalApp) {
    console.log("📍 Test mode: Internal app.handle (No server needed)");
  } else {
    console.log(`📍 Base URL: ${BASE_URL}`);
  }
  console.log("═".repeat(80));

  const results: TestResult[] = [];

  const root = await runTest("Root", "/", (data) => isObject(data) && data.status === "operational");
  results.push(root);

  const animeIndex = await runTest("Anime index", "/anime", (data) => {
    if (!isObject(data)) return false;
    return Array.isArray(data.providers) && data.providers.includes(PROVIDER);
  });
  results.push(animeIndex);

  // Search for One Piece to get a valid ID
  const searchResult = await requestJson(`/anime/${PROVIDER}/search/one%20piece`);
  let testId = "d58fc9f8-582e-fdf0-3618-112cd54ed5ab"; // Fallback
  if (isObject(searchResult.data) && Array.isArray(searchResult.data.results) && searchResult.data.results.length > 0) {
    const firstMatch = searchResult.data.results[0];
    if (isObject(firstMatch) && typeof firstMatch.id === "string") {
      testId = firstMatch.id;
    }
  }

  const providerInfo = await runTest("Provider info", `/anime/${PROVIDER}/info/${testId}`, (data) => {
    if (!isObject(data)) return false;
    return typeof data.id === "string" && typeof data.name === "string";
  });
  results.push(providerInfo);

  const episodes = await runTest("Episodes list", `/anime/${PROVIDER}/episodes/${testId}`, (data) => {
    if (!isObject(data)) return false;
    return Array.isArray(data.results);
  });
  results.push(episodes);

  const episodesPayload = await requestJson(`/anime/${PROVIDER}/episodes/${testId}`);
  let firstEpisodeId = "";
  let session = "";
  if (isObject(episodesPayload.data) && Array.isArray(episodesPayload.data.results) && episodesPayload.data.results.length > 0) {
    const first = episodesPayload.data.results[0];
    if (isObject(first)) {
      firstEpisodeId = String(first.episodeId || "");
      session = String(first.session || "");
    }
  }

  if (firstEpisodeId && session) {
    const stream = await runTest(
      "Episode stream",
      `/anime/${PROVIDER}/episode/${firstEpisodeId}/${session}`,
      (data) => isObject(data),
    );
    results.push(stream);
  }

  const mappings = await runTest("Mappings", "/mappings?anilist_id=21", (data) => {
    if (!isObject(data)) return false;
    return String(data.anilist_id) === "21";
  });
  results.push(mappings);

  const proxyIndex = await runTest("Proxy index", "/proxy", (data) => {
    if (!isObject(data)) return false;
    return Array.isArray(data.endpoints);
  });
  results.push(proxyIndex);

  for (const result of results) {
    const status = result.success ? "✅" : "❌";
    console.log(`${status} ${result.name} → ${result.status} (${result.responseTime}ms) ${result.endpoint}`);
    if (!result.success && result.error) {
      console.log(`   ${result.error}`);
    }
  }

  console.log("═".repeat(80));
  const passed = results.filter((r) => r.success).length;
  const total = results.length;
  console.log(`📊 Results: ${passed}/${total} checks passed`);

  if (passed !== total) {
    throw new Error(`${total - passed} test(s) failed`);
  }

  console.log("✅ Unified anime API tests passed.");
}


