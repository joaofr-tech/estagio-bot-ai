const gerenciador = require('./gerenciador_vagas.js');
const banco = gerenciador.carregarBanco();
const linksNoBanco = new Set(banco.map(v => (v.link || '').trim().toLowerCase()));

async function filterMatchingJobs() {
  const terms = [
    'software', 'desenvolvimento', 'dados', 'inteligencia artificial',
    'python', 'react', 'node', 'full stack', 'web', 'programacao', 'programador',
    'analise de dados', 'engenharia de dados', 'computacao', 'sistemas', 'ia', 'ti'
  ];

  const results = [];
  const seenIds = new Set();

  for (const t of terms) {
    const res = await fetch(`https://portal.gupy.io/api/job-search/jobs?limit=50&offset=0&type=vacancy_type_internship&jobName=${encodeURIComponent(t)}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Accept': 'application/json'
      }
    });
    const json = await res.json();
    const jobs = json.data || [];
    for (const j of jobs) {
      if (!seenIds.has(j.id)) {
        seenIds.add(j.id);
        results.push(j);
      }
    }
  }

  console.log('Total unique tech internships on Gupy:', results.length);

  const matched = [];

  for (const j of results) {
    const isRemote = j.workplaceType === 'remote';
    const city = (j.city || '').toLowerCase();
    const state = (j.state || '').toLowerCase();
    const isMetroBH = city.includes('belo horizonte') || city.includes('contagem') || city.includes('betim') || city.includes('ibirite') || city.includes('sarzedo') || city.includes('nova lima');

    if (!isRemote && !isMetroBH) continue;

    // Filter out non-tech (e.g. Psicologia, Enfermagem, Quimica, Civil, etc.)
    const name = j.name.toLowerCase();
    const nonTech = /enfermagem|psicologia|civil|produção|farmácia|direito|pedagogia|nutrição|química|gastronomia|mídias sociais|marketing|comunicação|suprimentos|contábil|financeiro|recursos humanos|atendimento/i;
    if (nonTech.test(name) && !/dados|ia|software|desenvolvimento|sistemas/i.test(name)) continue;

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

    matched.push({
      id: j.id,
      name: j.name,
      careerPageName: j.careerPageName,
      publishedDate: j.publishedDate,
      workplaceType: j.workplaceType,
      city: j.city,
      state: j.state,
      url: directUrl,
      inDb: inDb
    });
  }

  console.log(`Matched (Remote or Metro BH, Tech): ${matched.length}`);
  console.log(JSON.stringify(matched, null, 2));
}
filterMatchingJobs();
