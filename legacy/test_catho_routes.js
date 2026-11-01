async function searchCathoRoutes() {
  const routes = [
    'https://www.catho.com.br/vagas/estagio-em-desenvolvimento-de-software/',
    'https://www.catho.com.br/vagas/estagio-desenvolvedor/',
    'https://www.catho.com.br/vagas/estagio-em-dados/',
    'https://www.catho.com.br/vagas/estagio-engenharia-de-software/'
  ];

  for (const url of routes) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          'Accept': 'text/html'
        }
      });
      const html = await res.text();
      const jobCards = html.match(/<article[\s\S]*?<\/article>/gi) || [];
      console.log(`\nRoute: ${url} (Total: ${jobCards.length})`);
      for (const card of jobCards.slice(0, 5)) {
        const titleMatch = card.match(/<h2[^>]*>([\s\S]+?)<\/h2>/i);
        const linkMatch = card.match(/href="([^"]+)"/i);
        const title = titleMatch ? titleMatch[1].replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16))).replace(/<[^>]+>/g, '').trim() : '';
        const link = linkMatch ? 'https://www.catho.com.br' + linkMatch[1] : '';
        console.log(`  - ${title} | ${link}`);
      }
    } catch(e) {
      console.log('Error', url, e.message);
    }
  }
}
searchCathoRoutes();
