async function inspectJobs(subdomain) {
  try {
    const res = await fetch(`https://${subdomain}.gupy.io/`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });
    const html = await res.text();
    const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]+?)<\/script>/);
    if (!match) return;
    const data = JSON.parse(match[1]);
    const jobs = (data.props && data.props.pageProps && (data.props.pageProps.jobs || data.props.pageProps.jobList)) || [];
    console.log(`[${subdomain}] Total jobs:`, jobs.length);
    
    // Check all job types and names
    const interesting = jobs.filter(j => {
      const name = (j.name || '').toLowerCase();
      const type = (j.type || '').toLowerCase();
      return name.includes('estag') || name.includes('intern') || name.includes('trainee') || name.includes('talento') ||
             type.includes('estag') || type.includes('intern');
    });

    console.log(`[${subdomain}] Found ${interesting.length} matching jobs:`);
    for (const j of interesting) {
      console.log(JSON.stringify({
        id: j.id,
        name: j.name,
        type: j.type,
        publishedDate: j.publishedDate || j.createdAt,
        city: j.city,
        state: j.state,
        workplaceType: j.workplaceType,
        careerPageName: j.careerPageName
      }, null, 2));
    }
  } catch(e) {
    console.log(subdomain, 'ERR:', e.message);
  }
}

async function run() {
  await inspectJobs('localiza');
  await inspectJobs('stefanini');
}
run();
