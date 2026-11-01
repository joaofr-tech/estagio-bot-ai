async function run() {
  const res = await fetch('https://www.devvagas.com.br/vagas/estagio');
  const t = await res.text();
  const regex = /self\.__next_f\.push\(\[1,"([\s\S]+?)"\]\)/g;
  let m;
  let full = '';
  while ((m = regex.exec(t)) !== null) {
    full += m[1];
  }
  const unescaped = full.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  const urls = unescaped.match(/https?:\/\/[^\s",]+/g) || [];
  const uniqueUrls = Array.from(new Set(urls)).filter(u => 
    !u.includes('w3.org') && !u.includes('schema.org') && !u.includes('nextjs.org') && !u.includes('vercel')
  );
  console.log('URLs in /vagas/estagio:', uniqueUrls);
}
run();
