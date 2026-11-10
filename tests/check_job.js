const fs = require('fs');

async function checkUrl(url) {
  try {
    const res = await fetch(url);
    const html = await res.text();
    const isEncerrada = html.includes('Vaga encerrada') || html.includes('Processo Seletivo Encerrado') || html.includes('Esta vaga não está mais disponível');
    console.log('URL:', res.url);
    console.log('Status vaga:', isEncerrada ? 'ENCERRADA' : 'ATIVA');
    
    const nextDataMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s);
    if (nextDataMatch) {
      const data = JSON.parse(nextDataMatch[1]);
      const job = data.props?.pageProps?.job;
      if (job) {
        console.log('Job:', {
          id: job.id,
          name: job.name,
          type: job.type,
          workplaceType: job.workplaceType,
          city: job.city,
          state: job.state,
          publishedDate: job.publishedDate,
          status: job.status
        });
        console.log('Description:', (job.description || '').replace(/<[^>]+>/g, ' ').slice(0, 300));
        console.log('Prerequisites:', (job.prerequisites || '').replace(/<[^>]+>/g, ' ').slice(0, 300));
      }
    }
  } catch (e) {
    console.error('Erro:', e.message);
  }
}

const target = process.argv[2] || 'https://teknisa.gupy.io/jobs/12645776';
checkUrl(target);
