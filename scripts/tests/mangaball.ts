import { mangaball } from "../../src/providers/manga/mangaball/mangaball";

async function runMangaballTests() {
  console.log("🚀 === Starting Mangaball Provider Tests === 🚀\n");
  const MOCK_BASE_URL = "http://localhost:8000";

  try {
    // 1. Test Home
    console.log("⏳ 1. Testing parseHome()...");
    const homeData = await mangaball.parseHome(MOCK_BASE_URL);
    if ("error" in homeData) throw new Error(homeData.error as string);
    const homeItems = homeData.data as any[];
    console.log(`✅ Success! Found ${homeItems?.length || 0} items on the home page.\n`);

    // 2. Test Search
    console.log("⏳ 2. Testing parseSearch() for query 'martial'...");
    const searchData = await mangaball.parseSearch("martial", 1, MOCK_BASE_URL, 10);
    if ("error" in searchData) throw new Error(searchData.error as string);
    const searchItems = searchData.data as any[];
    console.log(`✅ Success! Found ${searchItems?.length || 0} search results.\n`);

    // 3. Test Detail (Using the first search result)
    if (searchItems && searchItems.length > 0) {
      const targetSlug = searchItems[0].slug;

      if (targetSlug) {
        console.log(`⏳ 3. Testing parseDetail() for slug: '${targetSlug}'...`);
        const detailData = await mangaball.parseDetail(targetSlug, MOCK_BASE_URL);
        if ("error" in detailData) throw new Error(detailData.error as string);
        console.log(`✅ Success! Fetched details for: "${detailData.title}"`);

        const chaptersList = (detailData.chapters as any)?.all_chapters;
        console.log(`   Found ${chaptersList?.length || 0} chapters.\n`);

        // 4. Test Read (Using the first chapter of the detail result)
        if (chaptersList && chaptersList.length > 0) {
          const targetChapterId = chaptersList[0].id_chapter;

          if (targetChapterId) {
            console.log(`⏳ 4. Testing parseRead() for chapter ID: '${targetChapterId}'...`);
            const readData = await mangaball.parseRead(targetChapterId, MOCK_BASE_URL);
            if ("error" in readData) throw new Error(readData.error as string);

            const images = readData.images as string[];
            console.log(`✅ Success! Extracted ${images?.length || 0} image URLs.\n`);
          }
        } else {
          console.log("⚠️ Skipped parseRead() test (No chapters found in detail result).\n");
        }
      }
    } else {
      console.log("⚠️ Skipped parseDetail() test (No search results found to derive a slug).\n");
    }

    // 5. Test Tags
    console.log("⏳ 5. Testing parseTags()...");
    const tagsData = await mangaball.parseTags();
    if ("error" in tagsData) throw new Error(tagsData.error as string);
    console.log(`✅ Success! Successfully fetched filter tags.\n`);

    console.log("🎉 === All Mangaball Tests Completed Successfully! === 🎉");

  } catch (error) {
    console.error("\n❌ === Test Failed! ===");
    console.error(error);
  }
}

// Run the tests
// runMangaballTests();

export { runMangaballTests };
