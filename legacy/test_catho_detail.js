async function inspectCatho(url) {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Accept': 'text/html'
      }
    });
    const html = await res.text();
    const clean = html.replace(/<script[\s\S]*?<\/script>/gi, '')
                      .replace(/<style[\s\S]*?<\/style>/gi, '')
                      .replace(/<[^>]+>/g, ' ')
                      .replace(/\s+/g, ' ');
    const title = html.match(/<title>([^<]+)<\/title>/i);
    console.log('\n========================================');
    console.log('URL:', url);
    console.log('Title:', title ? title[1] : 'N/A');
    const start = clean.indexOf('Sobre a vaga');
    console.log(clean.substring(start, start + 1200));
  } catch(e) {
    console.error('Error:', e.message);
  }
}

async function run() {
  await inspectCatho('https://www.catho.com.br/vagas/estagio-em-analise-de-dados/39005185');
  await inspectCatho('https://www.catho.com.br/vagas/estagiario-tecnologia-automacao-e-dados/39011049');
}
run();
