async function inspectChunk764More() {
  const res = await fetch('https://portal.gupy.io/_next/static/chunks/764-c58ed58be4fb97e9.js');
  const code = await res.text();
  const idx = code.indexOf('105424:function');
  console.log(code.substring(Math.max(0, idx - 400), idx + 200));
}
inspectChunk764More();
