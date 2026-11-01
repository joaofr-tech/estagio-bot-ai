const gerenciador = require('./gerenciador_vagas.js');
const banco = gerenciador.carregarBanco();
const linksNoBanco = new Set(banco.map(v => (v.link || '').trim().toLowerCase()));

async function inspectSolidesJob(url) {
  console.log('\n==================================================');
  console.log('URL:', url);

  // Check in DB
  let inDb = false;
  const idMatch = url.match(/vaga\/(\d+)/);
  const jobId = idMatch ? idMatch[1] : '';
  for (const bl of linksNoBanco) {
    if (bl.includes(url.toLowerCase()) || (jobId && bl.includes(jobId))) {
      inDb = true;
      break;
    }
  }
  console.log('In DB?:', inDb);

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });
    console.log('Status:', res.status);
    const html = await res.text();

    const titleMatch = html.match(/<h1[^>]*>([\s\S]+?)<\/h1>/i) || html.match(/<title>([^<]+)<\/title>/i);
    console.log('Title:', titleMatch ? titleMatch[1].trim() : 'N/A');

    const closed = html.includes('Vaga encerrada') || html.includes('não está mais disponível') || html.includes('Processo encerrado') || html.includes('Esta vaga foi finalizada');
    console.log('Closed?:', closed);

    // Extract text snippet to read turn/shift, modality, requirements
    const cleanText = html.replace(/<script[\s\S]*?<\/script>/gi, '')
                          .replace(/<style[\s\S]*?<\/style>/gi, '')
                          .replace(/<[^>]+>/g, ' ')
                          .replace(/\s+/g, ' ');

    // Look for Turno/Horário
    console.log('Snippet (first 600):', cleanText.substring(0, 600));

    // Search for hours or turn keywords
    const keywords = ['manhã', 'manha', 'tarde', 'vespertino', 'flexível', 'flexivel', 'horário', 'horario', 'bolsa', 'requisitos'];
    for (const kw of keywords) {
      const idx = cleanText.toLowerCase().indexOf(kw);
      if (idx !== -1) {
        console.log(`[KW: ${kw}]:`, cleanText.substring(Math.max(0, idx - 40), Math.min(cleanText.length, idx + 100)));
      }
    }
  } catch(e) {
    console.error('Error fetching:', e.message);
  }
}

async function run() {
  const urls = [
    'https://concert.vagas.solides.com.br/vaga/939337',
    'https://vagas.solides.com.br/vaga/881983',
    'https://vagas.solides.com.br/vaga/906761',
    'https://vagas.solides.com.br/vaga/776759',
    'https://grupofacil.vagas.solides.com.br/vaga/937354',
    'https://itone.vagas.solides.com.br/vaga/913667'
  ];
  for (const u of urls) {
    await inspectSolidesJob(u);
  }
}
run();
