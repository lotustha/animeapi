import * as cheerio from "cheerio";

async function main() {
  const res = await fetch('https://anigo.to/home', {
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });
  const html = await res.text();
  const $ = cheerio.load(html);
  
  $('.headerMenu ul a').each((i, el) => {
    console.log($(el).text().trim(), $(el).attr('href'));
  });
}

main().catch(console.error);
