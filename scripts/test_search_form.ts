import * as cheerio from "cheerio";

async function main() {
  const res = await fetch('https://anigo.to/browser?keyword=one+piece', {
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });
  console.log('Status:', res.status);
  const html = await res.text();
  const $ = cheerio.load(html);
  
  console.log('Results .unit:', $('.unit').length);
  console.log('Results .aitem:', $('.aitem').length);
}

main().catch(console.error);
