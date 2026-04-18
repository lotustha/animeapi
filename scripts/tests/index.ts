import { runAnimePaheTests } from "./animepahe";

async function main() {
  console.log("🔗 Running provider test suites...");

  await runAnimePaheTests();

  // future providers can be added here:
  // await runFlixHQTests();
  // await runWhateverTests();

  console.log("✅ All test suites completed successfully.");
}

main().catch((err) => {
  console.error("❌ Test runner failed:", err);
  process.exit(1);
});
