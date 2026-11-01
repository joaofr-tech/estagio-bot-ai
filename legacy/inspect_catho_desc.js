const fs = require('fs');

async function inspectCathoDesc(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html'
    }
  });
  const html = await res.text();
  const descMatch = html.match(/<div[^>]*description[^>]*>([\s\S]+?)<\/div>/i) ||
                    html.match(/itemprop="description"[^>]*>([\s\S]+?)<\//i);
  
  // Also find company
  const compMatch = html.match(/itemprop="name"[^>]*>([^<]+)<\//i);
  
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, '')
                   .replace(/<style[\s\S]*?<\/style>/gi, '')
                   .replace(/<[^>]+>/g, ' ')
                   .replace(/\s+/g, ' ');

  console.log(`\n========================================`);
  console.log(`URL: ${url}`);
  // Let's find "Descrição da vaga"
  const startIdx = text.indexOf('Descrição da vaga');
  if (startIdx !== -1) {
    console.log(text.substring(startIdx, startIdx + 1200));
  } else {
    console.log(text.substring(500, 1500));
  }
}

async function run() {
  await inspectCathoDesc('https://www.catho.com.br/vagas/estagio-automacao-ti/39018541');
  await inspectCathoDesc('https://www.catho.com.br/vagas/estagio-em-ti-oms/38966468');
  await inspectCathoDesc('https://www.catho.com.br/vagas/estagio-em-ti-sap/38851354');
}

run();
