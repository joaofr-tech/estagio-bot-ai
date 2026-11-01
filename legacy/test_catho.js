const gerenciador = require('./gerenciador_vagas.js');
const banco = gerenciador.carregarBanco();
const linksNoBanco = new Set(banco.map(v => (v.link || '').trim().toLowerCase()));

async function fetchAllCatho() {
  const url = 'https://www.catho.com.br/vagas/estagio-em-ti/belo-horizonte-mg/';
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'Accept': 'text/html'
    }
  });
  const html = await res.text();
  const jobCards = html.match(/<article[\s\S]*?<\/article>/gi) || [];
  console.log('Total articles:', jobCards.length);

  for (const card of jobCards) {
    const titleMatch = card.match(/<h2[^>]*>([\s\S]+?)<\/h2>/i);
    const linkMatch = card.match(/href="([^"]+)"/i);
    const companyMatch = card.match(/class="[^"]*company[^"]*"[^>]*>([\s\S]+?)<\//i) || card.match(/itemprop="hiringOrganization"[^>]*>([\s\S]+?)<\//i);
    const descMatch = card.match(/class="[^"]*description[^"]*"[^>]*>([\s\S]+?)<\//i) || card.match(/itemprop="description"[^>]*>([\s\S]+?)<\//i);

    const title = titleMatch ? titleMatch[1].replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16))).replace(/<[^>]+>/g, '').trim() : '';
    const link = linkMatch ? 'https://www.catho.com.br' + linkMatch[1] : '';

    console.log(`\n- Title: ${title}`);
    console.log(`  Link: ${link}`);
  }
}
fetchAllCatho();
