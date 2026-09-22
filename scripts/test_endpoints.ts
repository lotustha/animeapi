import * as cheerio from "cheerio";

async function main() {
  const endpoints = [
    '/browser',
    '/completed',
    '/new-releases',
    '/recent',
    '/movie',
    '/tv',
    '/ova',
    '/ona',
    '/special',
  ];

  for (const ep of endpoints) {
    const res = await fetch(`https://anigo.to${ep}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    console.log(`${ep} -> ${res.status}`);
  }
}

main().catch(console.error);
