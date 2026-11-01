const fs = require('fs');
const path = require('path');
const gerenciador = require('./gerenciador_vagas.js');

const banco = gerenciador.carregarBanco();
const linksNoBanco = new Set(banco.map(v => (v.link || '').trim().toLowerCase()));

async function inspectCandidate(url) {
  console.log('\n----------------------------------------');
  console.log('Testing candidate:', url);
  
  // Check if in DB
  const cleanUrl = url.split('?')[0].toLowerCase();
  for (const bl of linksNoBanco) {
    if (bl.includes(cleanUrl) || cleanUrl.includes(bl)) {
      console.log('-> Already in banco_vagas.json! Skipping.');
      return;
    }
  }

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });
    console.log('HTTP Status:', res.status);
    const html = await res.text();
    
    // Gupy
    if (url.includes('gupy.io')) {
      const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]+?)<\/script>/);
      if (match) {
        const data = JSON.parse(match[1]);
        const job = data.props.pageProps.job;
        if (!job) {
          console.log('Gupy job expired or closed!');
          return;
        }
        console.log('Title:', job.name);
        console.log('Status:', job.status);
        console.log('PublishedAt:', job.publishedAt);
        console.log('WorkplaceType:', job.workplaceType);
        console.log('City/State:', job.city, job.state);
        console.log('Description:', (job.description || '').replace(/<[^>]+>/g, ' ').substring(0, 300));
        console.log('Prerequisites:', (job.prerequisites || '').replace(/<[^>]+>/g, ' ').substring(0, 300));
        console.log('Additional Info:', (job.additionalInfo || '').replace(/<[^>]+>/g, ' ').substring(0, 300));
      }
    } 
    // Programathor
    else if (url.includes('programathor.com.br')) {
      const titleMatch = html.match(/<h1[^>]*>([\s\S]+?)<\/h1>/);
      console.log('Title:', titleMatch ? titleMatch[1].trim() : 'no title');
      const closed = html.includes('Vaga finalizada') || html.includes('Esta vaga foi finalizada');
      console.log('Is closed?:', closed);
      // Snippet
      const bodySnippet = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').substring(0, 500);
      console.log('Snippet:', bodySnippet);
    }
    // LinkedIn
    else if (url.includes('linkedin.com')) {
      const titleMatch = html.match(/<title>([^<]+)<\/title>/);
      console.log('Title:', titleMatch ? titleMatch[1] : 'no title');
      const closed = html.includes('No longer accepting applications') || html.includes('Não está mais aceitando candidaturas');
      console.log('Is closed?:', closed);
    }
  } catch (e) {
    console.error('Error fetching candidate:', e.message);
  }
}

async function run() {
  const candidates = [
    'https://domo.gupy.io/jobs/12562352',
    'https://br.linkedin.com/jobs/view/visagio-talentos-est%C3%A1gio-desenvolvedor-a-de-software-at-v-dev-4415239619',
    'https://programathor.com.br/jobs/29351-desenvolvedor-a-full-stack-estagio',
    'https://programathor.com.br/jobs/5219-estagio-desenvolvedor-a-full-stack-em-sao-paulo-sp',
    'https://programathor.com.br/jobs/14792-estagio-desenvolvedor-a-front-end-junior',
    'https://programathor.com.br/jobs/23457-estagio-em-desenvolvimento-web',
    'https://programathor.com.br/jobs/31601-estagio-desenvolvimento-web'
  ];
  for (const c of candidates) {
    await inspectCandidate(c);
  }
}
run();
