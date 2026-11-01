async function getFullDetails(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
  });
  const html = await res.text();
  console.log('\n======================================================');
  console.log('FULL DETAILS FOR:', url);
  const clean = html.replace(/<script[\s\S]*?<\/script>/gi, '')
                    .replace(/<style[\s\S]*?<\/style>/gi, '')
                    .replace(/<[^>]+>/g, ' ')
                    .replace(/\s+/g, ' ');
  console.log(clean);
}

async function run() {
  await getFullDetails('https://concert.vagas.solides.com.br/vaga/939337');
  await getFullDetails('https://vagas.solides.com.br/vaga/881983');
  await getFullDetails('https://vagas.solides.com.br/vaga/906761');
  await getFullDetails('https://vagas.solides.com.br/vaga/776759');
}
run();
