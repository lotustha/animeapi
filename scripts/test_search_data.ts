import * as cheerio from "cheerio";

async function main() {
  const res = await fetch('https://anigo.to/browser?keyword=one+piece', {
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });
  const html = await res.text();
  const $ = cheerio.load(html);
  
  // Find script tags or x-data that contain "one piece" or "episodes" or JSON arrays
  $('[x-data]').each((i, el) => {
    const xData = $(el).attr('x-data');
    if (xData && xData.includes('results') || xData?.includes('[')) {
      console.log('x-data snippet:', xData.substring(0, 200));
    }
  });

  // check if there's any window.__DATA__ or similar
  $('script').each((i, el) => {
    const text = $(el).text();
    if (text.includes('one piece') || text.includes('results')) {
      console.log('Script snippet:', text.substring(0, 300));
    }
  });
}

main().catch(console.error);
