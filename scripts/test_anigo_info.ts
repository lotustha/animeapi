import * as cheerio from "cheerio";

async function main() {
  const res = await fetch('https://anigo.to/browser?keyword=one+piece', {
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });
  const html = await res.text();
  const $ = cheerio.load(html);
  
  const href = $('.unit').first().attr('href') || $('.aitem').first().attr('href');
  console.log('First result href:', href);
  
  // also dump the card's html
  console.log('Card HTML:', $('.unit').first().parent().html() || $('.unit').first().html());

  if (href) {
    const infoRes = await fetch(`https://anigo.to${href}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    console.log('Info Status:', infoRes.status);
    const infoHtml = await infoRes.text();
    const $i = cheerio.load(infoHtml);
    
    // Check info selectors
    console.log('Title (.title):', $i('.title').first().text().trim());
    console.log('Title (h1):', $i('h1').first().text().trim());
    console.log('Description:', $i('.desc, .description').first().text().substring(0, 100));
    console.log('Type:', $i('.aniMeta span.type').text());
    console.log('Poster:', $i('.poster img').attr('src'));
    
    // Check episodes list
    console.log('Episodes count (list):', $i('.ep-item').length);
    console.log('First episode data:', $i('.ep-item').first().html()?.substring(0, 100));
  }
}

main().catch(console.error);
