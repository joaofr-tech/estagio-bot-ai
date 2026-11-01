async function inspect(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) {
      console.log('HTTP Status:', res.status, url);
      return;
    }
    const text = await res.text();
    const marker = 'id="__NEXT_DATA__"';
    const idx = text.indexOf(marker);
    if (idx !== -1) {
      const start = text.indexOf('>', idx) + 1;
      const end = text.indexOf('</script>', start);
      const jsonStr = text.substring(start, end);
      const data = JSON.parse(jsonStr);
      const job = data.props?.pageProps?.job;
      if (job) {
        console.log('=== VAGA ===');
        console.log('ID:', job.id);
        console.log('Name:', job.name);
        console.log('Company:', job.careerPageName);
        console.log('PublishedDate:', job.publishedDate);
        console.log('Status:', job.status);
        console.log('Workplace:', job.workplaceType);
        console.log('City/State:', job.city, job.state);
        console.log('Address:', job.addressCountry, job.addressCity, job.addressState);
        console.log('Description:', (job.description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 300));
        console.log('Prerequisites:', (job.prerequisites || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 300));
      } else {
        console.log('No job object found in __NEXT_DATA__');
      }
    } else {
      console.log('No __NEXT_DATA__ found in page');
    }
  } catch (err) {
    console.error(err.message);
  }
}

const urls = process.argv.slice(2);
(async () => {
  for (const u of urls) {
    await inspect(u);
  }
})();
