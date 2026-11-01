/**
 * verificar_emails.js
 * Monitor inteligente de e-mails para processos seletivos.
 * Filtra recibos passivos e detecta ações concretas (Testes Técnicos, Entrevistas, Prazos).
 */

const fs = require('fs');
const path = require('path');
const imaps = require('imap-simple');
const simpleParser = require('mailparser').simpleParser;

const CONFIG_PATH = path.join(__dirname, 'email_config.json');
const BANCO_PATH = path.join(__dirname, 'banco_vagas.json');
const BANCO_JS_PATH = path.join(__dirname, 'banco_vagas.js');
const LOG_PATH = path.join(__dirname, 'log_execucoes.txt');

function registrarLog(msg) {
  const ts = new Date().toLocaleString('pt-BR');
  const linha = `[${ts}] [EmailMonitor] ${msg}\n`;
  console.log(linha.trim());
  try {
    fs.appendFileSync(LOG_PATH, linha, 'utf8');
  } catch (e) {}
}

function carregarConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (e) {
    return null;
  }
}

function salvarConfig(cfg) {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
  } catch (e) {}
}

function carregarBanco() {
  if (!fs.existsSync(BANCO_PATH)) return [];
  try {
    return JSON.parse(fs.readFileSync(BANCO_PATH, 'utf8'));
  } catch (e) {
    return [];
  }
}

function salvarBanco(banco) {
  fs.writeFileSync(BANCO_PATH, JSON.stringify(banco, null, 2), 'utf8');
  fs.writeFileSync(BANCO_JS_PATH, `window.BANCO_VAGAS = ${JSON.stringify(banco, null, 2)};\n`, 'utf8');
}

function normalizar(texto) {
  return (texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

// Termos que indicam recibos meramente informativos (DEVE DESCARTAR)
const TERMOS_IGNORAR = [
  'recebemos sua candidatura',
  'candidatura enviada com sucesso',
  'inscricao confirmada',
  'sua candidatura foi aceita',
  'candidatura realizada',
  'obrigado por se candidatar',
  'obrigado por seu interesse',
  'agradecemos sua participacao',
  'vagas recomendadas para voce',
  'vagas similares',
  'alertas de vagas'
];

// Termos que indicam AÇÃO REAL (DEVE CAPTURAR)
const GATILHOS_ACAO = [
  { tipo: 'Teste Técnico / Desafio', termos: ['teste tecnico', 'hackerrank', 'gupy testes', 'desafio tecnico', 'teste online', 'avaliacao tecnica', 'fit cultural', 'mindsight', 'codility'] },
  { tipo: 'Entrevista / Agendamento', termos: ['convite para entrevista', 'agendamento de entrevista', 'calendly.com', 'google meet', 'microsoft teams', 'bate-papo com', 'entrevista com gestor', 'entrevista com rh'] },
  { tipo: 'Avanço de Fase', termos: ['voce avancou', 'proxima etapa', 'parabens! voce foi selecionado para a etapa', 'etapa seguinte', 'aprovado para'] },
  { tipo: 'Formulário / Dados Complementares', termos: ['formulario complementar', 'preenchimento obrigatorio', 'envio de documentos', 'informacoes adicionais necessarias'] }
];

/**
 * Analisa assunto e corpo para extrair link, prazo e empresa
 */
function analisarConteudoEmail(subject, textBody, htmlBody, from) {
  const normSubject = normalizar(subject);
  const normBody = normalizar(textBody || '');
  const combined = `${normSubject} ${normBody}`;

  // 1. Checar se é recibo passivo
  const ehReciboPassivo = TERMOS_IGNORAR.some(t => normSubject.includes(t) || combined.includes(t));
  
  // 2. Checar se tem gatilho de ação concreta
  let acaoDetectada = null;
  for (const g of GATILHOS_ACAO) {
    if (g.termos.some(t => combined.includes(t))) {
      acaoDetectada = g.tipo;
      break;
    }
  }

  // Se for apenas recibo passivo sem nenhuma ação de teste/entrevista, ignorar!
  if (ehReciboPassivo && !acaoDetectada) {
    return null;
  }

  if (!acaoDetectada) {
    return null;
  }

  // 3. Extrair link de ação relevante (HackerRank, Gupy, Calendly, Meet, Teams, Forms)
  const fullContent = `${textBody || ''} ${htmlBody || ''}`;
  const linkRegex = /(https?:\/\/[^\s<>"']+)/gi;
  const links = fullContent.match(linkRegex) || [];
  
  let linkAcao = '';
  const linksPrioritarios = links.filter(l => {
    const lLower = l.toLowerCase();
    return lLower.includes('hackerrank.com') ||
           lLower.includes('gupy.io') ||
           lLower.includes('calendly.com') ||
           lLower.includes('meet.google.com') ||
           lLower.includes('teams.microsoft.com') ||
           lLower.includes('forms') ||
           lLower.includes('teste') ||
           lLower.includes('interview');
  });

  if (linksPrioritarios.length > 0) {
    linkAcao = linksPrioritarios[0].replace(/[.,;!)]+$/, '');
  }

  // 4. Extrair prazo (Ex: "até 05/11", "prazo de 3 dias", "até às 18h do dia 04/11")
  let prazoDetectado = 'Não especificado';
  const prazoMatch = fullContent.match(/at[ée]\s+(\d{1,2}[\/\-\.]\d{1,2}(?:[\/\-\.]\d{2,4})?)/i) ||
                     fullContent.match(/prazo\s+de\s+(\d+\s+dias)/i) ||
                     fullContent.match(/limite\s*:\s*([^\n\r,\.<]+)/i);
  if (prazoMatch) {
    prazoDetectado = prazoMatch[0].trim();
  }

  // 5. Tentar identificar empresa no remetente ou assunto
  let empresaIdentificada = '';
  // Se for da Gupy: ex "Empresa Tal via Gupy"
  const gupyMatch = subject.match(/(.+?)\s+via\s+gupy/i) || from.match(/"?([^"<]+)"?\s*<.*gupy/i);
  if (gupyMatch) {
    empresaIdentificada = gupyMatch[1].trim();
  } else {
    // Tenta pegar antes de hífen ou traço no assunto
    const subjectParts = subject.split(/[-–—:|]/);
    if (subjectParts.length > 1) {
      empresaIdentificada = subjectParts[0].trim();
    }
  }

  return {
    acaoDetectada,
    linkAcao,
    prazoDetectado,
    empresaIdentificada,
    resumo: subject
  };
}

/**
 * Conecta ao Gmail e processa mensagens não lidas ou das últimas 48h
 */
async function verificarCaixaEntrada() {
  const cfg = carregarConfig();
  if (!cfg || !cfg.email || !cfg.appPassword) {
    registrarLog('Configuração de e-mail incompleta. Configure "email" e "appPassword" em email_config.json');
    return { sucesso: false, motivo: 'CONFIG_INCOMPLETA' };
  }

  const imapConfig = {
    imap: {
      user: cfg.email,
      password: cfg.appPassword,
      host: cfg.host || 'imap.gmail.com',
      port: cfg.port || 993,
      tls: cfg.tls !== false,
      authTimeout: 10000,
      tlsOptions: { rejectUnauthorized: false }
    }
  };

  try {
    registrarLog(`Conectando ao Gmail (${cfg.email})...`);
    const connection = await imaps.connect(imapConfig);
    await connection.openBox('INBOX');

    // Buscar mensagens recebidas nos últimos 2 dias
    const doisDiasAtras = new Date();
    doisDiasAtras.setDate(doisDiasAtras.getDate() - 2);
    const searchCriteria = [
      ['SINCE', doisDiasAtras]
    ];

    const fetchOptions = {
      bodies: ['HEADER', 'TEXT', ''],
      markSeen: false
    };

    const messages = await connection.search(searchCriteria, fetchOptions);
    registrarLog(`${messages.length} e-mail(s) recente(s) encontrado(s) na caixa de entrada.`);

    const banco = carregarBanco();
    let acoesAtualizadas = 0;

    for (const item of messages) {
      const all = item.parts.find(p => p.which === '');
      const id = item.attributes.uid;
      const idHeader = `Imap-Id: ${id}\r\n`;

      const parsed = await simpleParser(idHeader + all.body);
      const subject = parsed.subject || '';
      const from = (parsed.from && parsed.from.text) || '';
      const text = parsed.text || '';
      const html = parsed.html || '';

      const analise = analisarConteudoEmail(subject, text, html, from);

      if (analise) {
        registrarLog(`⚡ AÇÃO DETECTADA: [${analise.acaoDetectada}] - Assunto: "${subject}"`);
        
        // Localizar a vaga correspondente no banco
        let vagaEncontrada = null;
        if (analise.empresaIdentificada) {
          const empNorm = normalizar(analise.empresaIdentificada);
          vagaEncontrada = banco.find(v => {
            const vEmp = normalizar(v.empresa);
            return vEmp.includes(empNorm) || empNorm.includes(vEmp);
          });
        }

        // Se não achou por empresa exata, procurar no texto/assunto pelos nomes das empresas do banco
        if (!vagaEncontrada) {
          const combo = normalizar(`${subject} ${from} ${text.substring(0, 500)}`);
          vagaEncontrada = banco.find(v => {
            const vEmp = normalizar(v.empresa);
            return vEmp.length >= 3 && combo.includes(vEmp);
          });
        }

        const dataRecebimento = parsed.date ? parsed.date.toLocaleString('pt-BR') : new Date().toLocaleString('pt-BR');

        if (vagaEncontrada) {
          vagaEncontrada.status = 'acao_pendente';
          vagaEncontrada.detalhesAcao = {
            tipo: analise.acaoDetectada,
            link: analise.linkAcao || vagaEncontrada.link,
            prazo: analise.prazoDetectado,
            assunto: subject,
            dataRecebimento
          };
          acoesAtualizadas++;
          registrarLog(`-> Vaga vinculada com sucesso: "${vagaEncontrada.cargo}" na empresa "${vagaEncontrada.empresa}"`);
        } else {
          // Processo externo não cadastrado: criar card de processo ativo para o candidato não perder
          const novoId = `processo-email-${Date.now()}`;
          const empresaNome = analise.empresaIdentificada || from.split('@')[0] || 'Empresa Externa';
          banco.unshift({
            id: novoId,
            empresa: empresaNome,
            cargo: `Processo Seletivo (${analise.acaoDetectada})`,
            modalidade: 'Processo em Andamento',
            localizacao: 'Aguardando Ação',
            turno: 'Flexível',
            requisitos: `Ação detectada via e-mail: ${subject}`,
            link: analise.linkAcao || '#',
            dataColeta: dataRecebimento,
            status: 'acao_pendente',
            detalhesAcao: {
              tipo: analise.acaoDetectada,
              link: analise.linkAcao || '#',
              prazo: analise.prazoDetectado,
              assunto: subject,
              dataRecebimento
            }
          });
          acoesAtualizadas++;
          registrarLog(`-> Processo externo registrado para "${empresaNome}" para não perder o prazo.`);
        }
      }
    }

    if (acoesAtualizadas > 0) {
      salvarBanco(banco);
      registrarLog(`Total de ${acoesAtualizadas} ação(ões) pendente(s) salva(s) no banco de vagas!`);
    } else {
      registrarLog('Nenhum novo teste técnico ou entrevista pendente detectado nesta rodada.');
    }

    cfg.ultimoCheck = new Date().toLocaleString('pt-BR');
    salvarConfig(cfg);

    connection.end();
    return { sucesso: true, acoesAtualizadas };

  } catch (err) {
    registrarLog(`Erro na conexão com Gmail: ${err.message}`);
    return { sucesso: false, erro: err.message };
  }
}

// Execução direta via CLI
if (require.main === module) {
  verificarCaixaEntrada().then(res => {
    if (!res.sucesso && res.motivo === 'CONFIG_INCOMPLETA') {
      console.log('\n[Dica] Preencha seu email e appPassword no arquivo "email_config.json" para iniciar o monitoramento.');
    }
  });
}

module.exports = { verificarCaixaEntrada, analisarConteudoEmail };
