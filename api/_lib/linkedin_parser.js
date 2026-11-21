/**
 * Sona Resume Studio — Parser Determinístico de CSVs do Export Oficial do LinkedIn (.zip)
 * 100% determinístico (zero IA na ingestão), suporta RFC 4180 (aspas, vírgulas internas, quebras de linha)
 * e cabeçalhos em Inglês ou Português.
 */

function parseCSV(text) {
  if (!text || typeof text !== 'string') return [];
  const clean = text.replace(/^\uFEFF/, ''); // Remove UTF-8 BOM
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    const next = clean[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(field.trim());
        field = '';
      } else if (ch === '\r' && next === '\n') {
        row.push(field.trim());
        rows.push(row);
        row = [];
        field = '';
        i++;
      } else if (ch === '\n' || ch === '\r') {
        row.push(field.trim());
        rows.push(row);
        row = [];
        field = '';
      } else {
        field += ch;
      }
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field.trim());
    rows.push(row);
  }

  if (rows.length < 2) return [];
  const headers = rows[0].map((h) => h.trim());
  const records = [];

  for (let r = 1; r < rows.length; r++) {
    const values = rows[r];
    if (values.every((v) => !v)) continue;
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = values[idx] !== undefined ? values[idx] : '';
    });
    records.push(obj);
  }
  return records;
}

function pickField(row, candidates) {
  const keys = Object.keys(row);
  for (const cand of candidates) {
    const exact = row[cand];
    if (exact !== undefined && exact !== '') return exact;
    const foundKey = keys.find((k) => k.toLowerCase() === cand.toLowerCase());
    if (foundKey && row[foundKey]) return row[foundKey];
  }
  return '';
}

function splitFacts(description) {
  if (!description) return [];
  return description
    .split(/\r?\n|(?:\s*[•·▪]\s*)/)
    .map((line) => line.replace(/^[-*]\s*/, '').trim())
    .filter((line) => line.length >= 6);
}

/**
 * Converte um mapa { "Profile.csv": "...", "Positions.csv": "...", ... }
 * em um objeto parcial de MasterProfile pronto para merge.
 */
function parseLinkedInFiles(csvMap = {}) {
  const findCsv = (pattern) => {
    const key = Object.keys(csvMap).find((k) => pattern.test(k.toLowerCase()));
    return key ? parseCSV(csvMap[key]) : [];
  };

  const profileRows = findCsv(/(^|\/)profile\.csv$/);
  const positionRows = findCsv(/(^|\/)positions\.csv$/);
  const educationRows = findCsv(/(^|\/)education\.csv$/);
  const skillRows = findCsv(/(^|\/)skills\.csv$/);
  const certRows = findCsv(/(^|\/)certifications\.csv$/);
  const projectRows = findCsv(/(^|\/)projects\.csv$/);
  const langRows = findCsv(/(^|\/)languages\.csv$/);

  const basics = {};
  if (profileRows.length > 0) {
    const p = profileRows[0];
    const first = pickField(p, ['First Name', 'Nome']);
    const last = pickField(p, ['Last Name', 'Sobrenome']);
    const fullName = [first, last].filter(Boolean).join(' ').trim();
    if (fullName) basics.name = fullName;
    const headline = pickField(p, ['Headline', 'Título']);
    if (headline) basics.headline = headline;
    const geo = pickField(p, ['Geo Location', 'Localização', 'Location']);
    if (geo) basics.location = geo;
    const summary = pickField(p, ['Summary', 'Resumo']);
    if (summary) basics.summary = summary;
  }

  const experiences = positionRows
    .map((r, idx) => {
      const company = pickField(r, ['Company Name', 'Empresa', 'Nome da empresa']);
      const role = pickField(r, ['Title', 'Cargo']);
      if (!company && !role) return null;
      const desc = pickField(r, ['Description', 'Descrição']);
      return {
        id: `li-exp-${idx + 1}`,
        company: company || 'Empresa',
        role: role || 'Cargo',
        location: pickField(r, ['Location', 'Localização']),
        start_date: pickField(r, ['Started On', 'Data de início']),
        end_date: pickField(r, ['Finished On', 'Data de término']) || 'Atual',
        facts: splitFacts(desc),
        verified_skills: [],
        source: 'linkedin_zip'
      };
    })
    .filter(Boolean);

  const education = educationRows
    .map((r, idx) => {
      const institution = pickField(r, ['School Name', 'Instituição de ensino', 'Escola']);
      if (!institution) return null;
      const degree = pickField(r, ['Degree Name', 'Formação', 'Diploma']);
      const notes = pickField(r, ['Notes', 'Activities', 'Atividades']);
      return {
        id: `li-edu-${idx + 1}`,
        institution,
        degree: degree || 'Graduação',
        field: pickField(r, ['Field Of Study', 'Área de estudo']) || '',
        start_date: pickField(r, ['Start Date', 'Data de início']),
        end_date: pickField(r, ['End Date', 'Data de término']),
        highlights: splitFacts(notes),
        source: 'linkedin_zip'
      };
    })
    .filter(Boolean);

  const skills = Array.from(
    new Set(
      skillRows
        .map((r) => pickField(r, ['Name', 'Nome', 'Skill']))
        .map((s) => s.trim())
        .filter(Boolean)
    )
  );

  const certifications = certRows
    .map((r, idx) => {
      const name = pickField(r, ['Name', 'Nome']);
      if (!name) return null;
      return {
        id: `li-cert-${idx + 1}`,
        name,
        authority: pickField(r, ['Authority', 'Organização emissora']),
        date: pickField(r, ['Started On', 'Data de emissão']),
        url: pickField(r, ['Url', 'URL da credencial']),
        source: 'linkedin_zip'
      };
    })
    .filter(Boolean);

  const projects = projectRows
    .map((r, idx) => {
      const name = pickField(r, ['Title', 'Título', 'Name']);
      if (!name) return null;
      const desc = pickField(r, ['Description', 'Descrição']);
      return {
        id: `li-proj-${idx + 1}`,
        name,
        url: pickField(r, ['Url', 'URL']),
        languages: [],
        readme_summary: desc,
        facts: splitFacts(desc),
        verified_skills: [],
        source: 'linkedin_zip'
      };
    })
    .filter(Boolean);

  const languages_spoken = langRows
    .map((r) => ({
      name: pickField(r, ['Name', 'Idioma']),
      proficiency: pickField(r, ['Proficiency', 'Nível'])
    }))
    .filter((l) => l.name);

  return {
    basics,
    experiences,
    education,
    projects,
    skills_whitelist: skills,
    certifications,
    languages_spoken
  };
}

module.exports = {
  parseCSV,
  parseLinkedInFiles
};
