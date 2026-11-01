async function checkGupyJob(url) {
  try {
    const res = await fetch(url);
    const html = await res.text();
    const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]+?)<\/script>/);
    if (!match) return;
    const data = JSON.parse(match[1]);
    const job = data.props.pageProps.job;
    console.log('=== VAGA ===');
    console.log('Title:', job.name);
    console.log('Status:', job.status);
    console.log('PublishedAt:', job.publishedAt);
    console.log('WorkplaceType:', job.workplaceType);
    console.log('City/State:', job.city, job.state);
    console.log('Description:', (job.description || '').replace(/<[^>]+>/g, ' ').substring(0, 300));
    console.log('Prerequisites:', (job.prerequisites || '').replace(/<[^>]+>/g, ' ').substring(0, 300));
    console.log('Additional Info:', (job.additionalInfo || '').replace(/<[^>]+>/g, ' ').substring(0, 300));
    console.log('URL:', url);
  } catch (err) {
    console.error('Error fetching', url, err.message);
  }
}
checkGupyJob('https://stefanini.gupy.io/jobs/12411574');
