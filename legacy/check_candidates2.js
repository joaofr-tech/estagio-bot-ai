const fs = require('fs');
const gerenciador = require('./gerenciador_vagas.js');

const banco = gerenciador.carregarBanco();
const linksNoBanco = new Set(banco.map(v => (v.link || '').trim().toLowerCase()));

async function checkCandidates() {
  const list = [
    { name: 'Hike Capital', url: 'https://www.linkedin.com/jobs/view/4468915785/' },
    { name: 'Apollo Solutions', url: 'https://app.sesametime.com/jobs/apollosolutionsdev/c3006e0f-ba14-4ed8-8dd2-4ad5b7a50866/overview' },
    { name: 'Radix', url: 'https://radix.inhire.app/vagas/d997c854-4c23-4202-ac07-b7ec898575fd/profissional-estagiario-em-desenvolvimento' },
    { name: 'SiDi', url: 'https://sidi.gupy.io/jobs/12458731' },
    { name: 'Samsung', url: 'https://br.linkedin.com/jobs/view/4450297759' },
    { name: 'Fundacao Elos', url: 'https://elos.org.br/vaga/estagio-em-tecnologia-da-informacao-ti/' }
  ];

  for (const item of list) {
    console.log('\n========================================');
    console.log(`Checking: ${item.name} (${item.url})`);

    // In DB check
    const cleanUrl = item.url.split('?')[0].toLowerCase();
    let already = false;
    for (const bl of linksNoBanco) {
      if (bl.includes(cleanUrl) || cleanUrl.includes(bl)) {
        already = true;
        break;
      }
    }
    const alreadyCompany = banco.some(b => b.empresa.toLowerCase().includes(item.name.toLowerCase()));
    console.log('Already in DB (URL):', already, '| Already by company:', alreadyCompany);

    try {
      const res = await fetch(item.url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
      });
      console.log('HTTP Status:', res.status);
      const text = await res.text();
      const titleMatch = text.match(/<title>([^<]+)<\/title>/i);
      console.log('Page Title:', titleMatch ? titleMatch[1].trim() : 'No title');
      
      if (item.url.includes('gupy.io')) {
        const nextMatch = text.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]+?)<\/script>/);
        if (nextMatch) {
          const job = JSON.parse(nextMatch[1]).props.pageProps.job;
          console.log('Gupy Job Status:', job ? job.status : 'no job');
          console.log('PublishedAt:', job ? job.publishedAt : '');
          console.log('Workplace:', job ? job.workplaceType : '');
          console.log('Prerequisites:', job ? (job.prerequisites || '').replace(/<[^>]+>/g, ' ').substring(0, 200) : '');
          console.log('Additional:', job ? (job.additionalInfo || '').replace(/<[^>]+>/g, ' ').substring(0, 200) : '');
        }
      } else if (item.url.includes('linkedin.com')) {
        const closed = text.includes('No longer accepting applications') || text.includes('Não está mais aceitando candidaturas');
        console.log('LinkedIn closed?:', closed);
      } else if (item.url.includes('sesametime.com')) {
        const snippet = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').substring(0, 400);
        console.log('Sesame snippet:', snippet);
      } else if (item.url.includes('inhire.app')) {
        const snippet = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').substring(0, 400);
        console.log('InHire snippet:', snippet);
      } else if (item.url.includes('elos.org.br')) {
        const snippet = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').substring(0, 400);
        console.log('Elos snippet:', snippet);
      }
    } catch(e) {
      console.log('Error:', e.message);
    }
  }
}
checkCandidates();
