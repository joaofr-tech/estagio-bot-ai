async function searchTechInternships() {
  const terms = [
    'software', 'desenvolvimento', 'dados', 'inteligencia artificial',
    'python', 'react', 'node', 'full stack', 'web', 'programacao', 'programador',
    'analise de dados', 'engenharia de dados', 'computacao', 'sistemas'
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

  console.log('Total unique tech internships found on Gupy:', results.length);
  for (const j of results) {
    console.log(`- [${j.careerPageName}] ${j.name} | ${j.publishedDate} | ${j.workplaceType} | ${j.city || ''} ${j.state || ''} | ID: ${j.id}`);
  }
}
searchTechInternships();
