async function inspectProgramathorList() {
  const url = `https://programathor.com.br/jobs?q=estagio`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
  const html = await res.text();
  const links = html.match(/href="(\/jobs\/\d+-[^"]+)"/gi) || [];
  console.log('Total job links:', links.length);
  const unique = [...new Set(links)];
  for (const l of unique) {
    console.log(l);
  }
}
inspectProgramathorList();
