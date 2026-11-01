const fs = require('fs');
const gerenciador = require('./gerenciador_vagas.js');

const banco = gerenciador.carregarBanco();
const linksNoBanco = new Set(banco.map(v => (v.link || '').trim().toLowerCase()));

async function searchGupy(query, workplaceType, city, state) {
  const params = new URLSearchParams({
    limit: '20',
    offset: '0'
  });
  if (query) params.append('jobName', query);
  if (workplaceType) params.append('workplaceType', workplaceType);
  if (city) params.append('city', city);
  if (state) params.append('state', state);

  const url = `https://portal.gupy.io/api/job-search/jobs?${params.toString()}`;
  console.log(`\n======================================================`);
  console.log(`Searching: query="${query || ''}", workplace="${workplaceType || ''}", city="${city || ''}"`);
  console.log(`URL: ${url}`);

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Accept': 'application/json'
      }
    });

    if (!res.ok) {
      console.log('HTTP error:', res.status);
      return [];
    }

    const json = await res.json();
    const jobs = json.data || [];
    console.log(`Found ${jobs.length} jobs.`);

    const candidates = [];

    for (const j of jobs) {
      // Must be internship
      const isIntern = /est[aá]g|intern/i.test(j.name) || (j.type && /est[aá]g|intern/i.test(j.type));
      if (!isIntern) continue;

      const directUrl = j.jobUrl || `https://${j.careerPageName}.gupy.io/jobs/${j.id}`;
      const cleanUrl = directUrl.split('?')[0].toLowerCase();

      // Check DB
      let inDb = false;
      for (const bl of linksNoBanco) {
        if (bl.includes(cleanUrl) || cleanUrl.includes(bl) || bl.includes(String(j.id))) {
          inDb = true;
          break;
        }
      }

      console.log(`\n* [${j.careerPageName}] ${j.name}`);
      console.log(`  PublishedAt: ${j.publishedDate || j.createdAt}`);
      console.log(`  Type: ${j.type} | Workplace: ${j.workplaceType} | City: ${j.city || ''} ${j.state || ''}`);
      console.log(`  URL: ${directUrl}`);
      console.log(`  In DB?: ${inDb}`);

      if (!inDb) {
        candidates.push({
          job: j,
          url: directUrl
        });
      }
    }

    return candidates;
  } catch (e) {
    console.error('Error:', e.message);
    return [];
  }
}

async function run() {
  const queries = [
    // Remote
    { q: 'estagio software', wp: 'remote' },
    { q: 'estagio desenvolvimento', wp: 'remote' },
    { q: 'estagio dados', wp: 'remote' },
    { q: 'estagio inteligencia artificial', wp: 'remote' },
    { q: 'estagio python', wp: 'remote' },
    
    // Belo Horizonte
    { q: 'estagio software', city: 'Belo Horizonte', state: 'MG' },
    { q: 'estagio desenvolvimento', city: 'Belo Horizonte', state: 'MG' },
    { q: 'estagio tecnologia', city: 'Belo Horizonte', state: 'MG' },
    { q: 'estagio dados', city: 'Belo Horizonte', state: 'MG' },
    { q: 'estagio TI', city: 'Belo Horizonte', state: 'MG' }
  ];

  const allNew = [];

  for (const item of queries) {
    const res = await searchGupy(item.q, item.wp, item.city, item.state);
    allNew.push(...res);
  }

  console.log(`\n\n================ TOTAL NEW CANDIDATES: ${allNew.length} ================`);
  fs.writeFileSync('gupy_candidates.json', JSON.stringify(allNew, null, 2), 'utf8');
}
run();
