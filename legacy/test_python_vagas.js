async function inspectHtml() {
  const res = await fetch('https://python.dev.br/vagas/');
  const html = await res.text();
  const links = html.match(/href='([^']+)'/g) || [];
  console.log('Single quote hrefs:', links.length);
  const estag = html.match(/.{0,50}est[aá]g.{0,50}/gi) || [];
  console.log('Estag mentions:', estag.slice(0, 10));
}
inspectHtml();
