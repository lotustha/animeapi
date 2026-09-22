import * as cheerio from "cheerio";

async function main() {
  const res = await fetch('https://anigo.to/browser?keyword=one+piece', {
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });
  const html = await res.text();
  const $ = cheerio.load(html);
  
  $('.unit').each((i, el) => {
    console.log(`Href [${i}]:`, $(el).attr('href'));
  });
}

main().catch(console.error);
