/**
 * verificar_emails.js
 * Monitor inteligente de e-mails para processos seletivos.
 * Classifica confirmações, convocações (Testes/Entrevistas), rejeições, ofertas e outreach,
 * identifica follow-ups pendentes (>21 dias) e sincroniza opcionalmente com o Supabase.
 */

const fs = require('fs');
const path = require('path');
const imaps = require('imap-simple');
const simpleParser = require('mailparser').simpleParser;
const { upsertVagasSupabase } = require('./supabase_client');

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

// Termos que indicam recibos meramente informativos de inscrição recebida
const TERMOS_CONFIRMACAO_INSCRICAO = [
  'recebemos sua candidatura',
  'candidatura recebida',
  'candidatura enviada com sucesso',
  'inscricao confirmada',
  'sua candidatura foi aceita',
  'candidatura realizada',
  'obrigado por se candidatar',
  'obrigado por seu interesse',
  'agradecemos sua participacao',
  'application received',
  'thank you for applying'
];

// Termos que indicam proposta/oferta
const TERMOS_OFERTA = [
  'proposta de estagio',
  'carta proposta',
  'temos uma proposta para voce',
  'voce foi aprovado no processo',
  'voce foi aprovada no processo',
  'offer letter',
  'formal offer',
  'pleased to offer you'
];

// Termos que indicam encerramento/rejeição do processo seletivo
const TERMOS_REJEICAO = [
  'nao seguiremos com sua candidatura',
  'nao vamos seguir com sua candidatura',
  'optamos por seguir com outros candidatos',
  'decidimos seguir com outros',
  'nao foi selecionado para a proxima etapa',
  'nao foi selecionada para a proxima etapa',
  'infelizmente nao poderemos seguir',
  'vaga foi preenchida',
  'posicao foi preenchida',
  'processo seletivo foi encerrado',
  'vaga cancelada',
  'vaga congelada',
  'we will not be moving forward',
  'decided to move forward with other candidates',
  'position has been filled',
  'not selected to move forward'
];

// Termos que indicam ação imediata e convocação real
const GATILHOS_ACAO_IMEDIATA = [
  { tipo: 'Teste Técnico / Desafio', termos: ['convite para teste', 'realize o teste', 'faca seu teste', 'seu teste esta disponivel', 'teste liberado', 'desafio tecnico liberado', 'link do teste', 'hackerrank.com/test', 'mindsight', 'codility', 'take-home', 'coding challenge'] },
  { tipo: 'Entrevista / Agendamento', termos: ['convite para entrevista', 'agendamento de entrevista', 'escolha um horario', 'calendly.com/', 'agende sua entrevista', 'entrevista com gestor', 'entrevista tecnica agendamento', 'interview invitation', 'schedule an interview'] },
  { tipo: 'Avanço de Fase', termos: ['voce avancou para a fase', 'parabens! voce foi selecionado para a etapa seguinte', 'proxima etapa: teste', 'proxima etapa: entrevista', 'moved to the next stage'] },
  { tipo: 'Formulário / Dados Complementares', termos: ['preenchimento obrigatorio', 'envio de documentos pendente', 'formulario complementar obrigatorio'] }
];

const TERMOS_OUTREACH = [
  'vi seu perfil no linkedin',
  'gostaria de conversar sobre uma vaga',
  'oportunidade de estagio em nossa equipe',
  'reaching out about a role',
  'came across your profile'
];

/**
 * Analisa assunto e corpo para classificar o evento, extrair link, prazo e empresa.
 */
function analisarConteudoEmail(subject, textBody, htmlBody, from) {
  const normSubject = normalizar(subject);
  const normBody = normalizar(textBody || '');
  const combined = `${normSubject} \n ${normBody}`;

  // 1. Tentar identificar empresa no remetente ou assunto
  let empresaIdentificada = '';
  const gupyMatch = subject.match(/(.+?)\s+via\s+gupy/i) || from.match(/"?([^"<]+)"?\s*<.*gupy/i);
  if (gupyMatch) {
    empresaIdentificada = gupyMatch[1].trim();
  } else {
    const subjectParts = subject.split(/[-–—:|]/);
    if (subjectParts.length > 1) {
      empresaIdentificada = subjectParts[0].trim();
    }
  }

  // 2. Checar OFERTA (prioridade máxima)
  if (TERMOS_OFERTA.some(t => combined.includes(t))) {
    return {
      tipoEvento: 'OFERTA',
      empresaIdentificada,
      resumo: subject
    };
  }

  // 3. Checar se é uma chamada para AÇÃO REAL IMEDIATA
  let acaoDetectada = null;
  for (const g of GATILHOS_ACAO_IMEDIATA) {
    if (g.termos.some(t => combined.includes(t))) {
      acaoDetectada = g.tipo;
      break;
    }
  }

  // 4. Checar REJEIÇÃO / VAGA PREENCHIDA (apenas quando não há convocação ativa)
  const termoRejeicao = TERMOS_REJEICAO.find(t => combined.includes(t));
  if (termoRejeicao && !acaoDetectada) {
    return {
      tipoEvento: 'REJEICAO',
      motivoRejeicao: termoRejeicao,
      empresaIdentificada,
      resumo: subject
    };
  }

  // 5. Checar se é recibo de candidatura confirmada (sem ação necessária agora)
  const ehConfirmacaoInscricao = TERMOS_CONFIRMACAO_INSCRICAO.some(t => normSubject.includes(t) || combined.includes(t));
  const avisoSemAcao = combined.includes('nao precisa se preocupar') || combined.includes('vamos te atualizando') || combined.includes('em breve entraremos em contato');

  if (ehConfirmacaoInscricao && (avisoSemAcao || !acaoDetectada)) {
    return {
      tipoEvento: 'CONFIRMACAO_CANDIDATURA',
      empresaIdentificada,
      resumo: subject
    };
  }

  // 6. Checar abordagem de recrutador (outreach)
  if (!acaoDetectada && TERMOS_OUTREACH.some(t => combined.includes(t))) {
    return {
      tipoEvento: 'OUTREACH',
      empresaIdentificada,
      resumo: subject
    };
  }

  // Se não detectou ação imediata, ignorar (alertas, newsletters, recibos passivos)
  if (!acaoDetectada) {
    return null;
  }

  // 7. Extrair link de ação relevante (HackerRank, Gupy, Calendly, Meet, Teams, Forms)
  const fullContent = `${textBody || ''} ${htmlBody || ''}`;
  const linkRegex = /(https?:\/\/[^\s<>"']+)/gi;
  const links = fullContent.match(linkRegex) || [];

  let linkAcao = '';
  const linksPrioritarios = links.filter(l => {
    const lLower = l.toLowerCase();
    return lLower.includes('hackerrank.com') ||
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

  // 8. Extrair prazo (Ex: "até 05/11", "prazo de 3 dias", "até às 18h do dia 04/11")
  let prazoDetectado = 'Não especificado';
  const prazoMatch = fullContent.match(/at[ée]\s+(\d{1,2}[\/\-\.]\d{1,2}(?:[\/\-\.]\d{2,4})?)/i) ||
                     fullContent.match(/prazo\s+de\s+(\d+\s+dias)/i) ||
                     fullContent.match(/limite\s*:\s*([^\n\r,\.<]+)/i);
  if (prazoMatch) {
    prazoDetectado = prazoMatch[0].trim();
  }

  return {
    tipoEvento: 'ACAO_PENDENTE',
    acaoDetectada,
    linkAcao,
    prazoDetectado,
    empresaIdentificada,
    resumo: subject
  };
}

/**
 * Converte datas pt-BR ("DD/MM/YYYY, HH:MM:SS") ou ISO para timestamp em ms.
 */
function parseDataParaMs(valor) {
  if (!valor) return null;
  if (typeof valor === 'number' && Number.isFinite(valor)) return valor;
  const str = String(valor).trim();
  const br = str.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) {
    const dt = new Date(Number(br[3]), Number(br[2]) - 1, Number(br[1]));
    return Number.isNaN(dt.getTime()) ? null : dt.getTime();
  }
  const iso = Date.parse(str);
  return Number.isNaN(iso) ? null : iso;
}

/**
 * Identifica candidaturas com status 'aplicada' sem resposta há N+ dias (padrão: 21 dias,
 * inspirado em job-hunt-agent/workflows/inbox.md).
 */
function identificarFollowupsPendentes(banco = [], diasSemResposta = 21, agora = new Date()) {
  const limiteMs = diasSemResposta * 24 * 60 * 60 * 1000;
  const nowMs = agora instanceof Date ? agora.getTime() : Number(agora);
  const pendentes = [];

  for (const vaga of Array.isArray(banco) ? banco : []) {
    if (!vaga || vaga.status !== 'aplicada') continue;
    const refMs = parseDataParaMs(vaga.dataAplicacao || vaga.dataColeta || vaga.data_coleta);
    if (!refMs) continue;
    const deltaMs = nowMs - refMs;
    if (deltaMs >= limiteMs) {
      pendentes.push({
        id: vaga.id,
        empresa: vaga.empresa,
        cargo: vaga.cargo,
        link: vaga.link,
        diasSemResposta: Math.floor(deltaMs / (24 * 60 * 60 * 1000))
      });
    }
  }
  return pendentes.sort((a, b) => b.diasSemResposta - a.diasSemResposta);
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
    const searchCriteria = [['SINCE', doisDiasAtras]];

    const fetchOptions = {
      bodies: ['HEADER', 'TEXT', ''],
      markSeen: false
    };

    const messages = await connection.search(searchCriteria, fetchOptions);
    registrarLog(`${messages.length} e-mail(s) recente(s) encontrado(s) na caixa de entrada.`);

    const banco = carregarBanco();
    let acoesAtualizadas = 0;
    const vagasModificadas = [];

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
      if (!analise) continue;

      // Localizar a vaga correspondente no banco
      let vagaEncontrada = null;
      if (analise.empresaIdentificada) {
        const empNorm = normalizar(analise.empresaIdentificada);
        vagaEncontrada = banco.find(v => {
          const vEmp = normalizar(v.empresa);
          return vEmp && empNorm && (vEmp.includes(empNorm) || empNorm.includes(vEmp));
        });
      }

      if (!vagaEncontrada) {
        const combo = normalizar(`${subject} ${from} ${text.substring(0, 500)}`);
        vagaEncontrada = banco.find(v => {
          const vEmp = normalizar(v.empresa);
          return vEmp.length >= 3 && combo.includes(vEmp);
        });
      }

      const dataRecebimento = parsed.date ? parsed.date.toLocaleString('pt-BR') : new Date().toLocaleString('pt-BR');

      if (analise.tipoEvento === 'OFERTA') {
        registrarLog(`PROPOSTA/OFERTA DETECTADA: "${subject}"`);
        if (vagaEncontrada) {
          vagaEncontrada.status = 'acao_pendente';
          vagaEncontrada.etapaConcluida = false;
          vagaEncontrada.detalhesAcao = {
            tipo: 'Proposta / Oferta',
            link: vagaEncontrada.link,
            prazo: 'Revisar imediatamente',
            assunto: subject,
            dataRecebimento
          };
          vagasModificadas.push(vagaEncontrada);
          acoesAtualizadas++;
        }
        continue;
      }

      if (analise.tipoEvento === 'REJEICAO') {
        if (vagaEncontrada && !['encerrada', 'descartada'].includes(vagaEncontrada.status)) {
          vagaEncontrada.status = 'encerrada';
          vagaEncontrada.dataEncerramento = dataRecebimento;
          vagaEncontrada.motivoEncerramento = `Retorno via e-mail: ${analise.motivoRejeicao}`;
          vagasModificadas.push(vagaEncontrada);
          acoesAtualizadas++;
          registrarLog(`Retorno negativo/encerramento detectado para "${vagaEncontrada.cargo}" (${vagaEncontrada.empresa}).`);
        }
        continue;
      }

      if (analise.tipoEvento === 'CONFIRMACAO_CANDIDATURA') {
        if (vagaEncontrada && vagaEncontrada.status === 'para_aplicar') {
          vagaEncontrada.status = 'aplicada';
          vagaEncontrada.candidaturaExterna = true;
          vagaEncontrada.dataAplicacao = dataRecebimento;
          vagasModificadas.push(vagaEncontrada);
          acoesAtualizadas++;
          registrarLog(`Candidatura confirmada via e-mail: "${vagaEncontrada.cargo}" (${vagaEncontrada.empresa}).`);
        }
        continue;
      }

      if (analise.tipoEvento === 'ACAO_PENDENTE') {
        registrarLog(`CONVOCACAO/ACAO DETECTADA: [${analise.acaoDetectada}] - Assunto: "${subject}"`);

        if (vagaEncontrada) {
          if (vagaEncontrada.etapaConcluida && vagaEncontrada.detalhesAcao && vagaEncontrada.detalhesAcao.assunto === subject) {
            registrarLog(`-> Ação já concluída anteriormente: "${subject}". Mantendo status atual.`);
            continue;
          }

          vagaEncontrada.status = 'acao_pendente';
          vagaEncontrada.etapaConcluida = false;
          vagaEncontrada.detalhesAcao = {
            tipo: analise.acaoDetectada,
            link: analise.linkAcao || vagaEncontrada.link,
            prazo: analise.prazoDetectado,
            assunto: subject,
            dataRecebimento
          };
          vagasModificadas.push(vagaEncontrada);
          acoesAtualizadas++;
          registrarLog(`-> Vaga vinculada: "${vagaEncontrada.cargo}" na empresa "${vagaEncontrada.empresa}"`);
        } else {
          const novoId = `processo-email-${Date.now()}`;
          const empresaNome = analise.empresaIdentificada || from.split('@')[0] || 'Empresa Externa';
          const novoRegistro = {
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
          };
          banco.unshift(novoRegistro);
          if (novoRegistro.link && /^https?:\/\//i.test(novoRegistro.link)) {
            vagasModificadas.push(novoRegistro);
          }
          acoesAtualizadas++;
          registrarLog(`-> Processo externo registrado para "${empresaNome}".`);
        }
      }
    }

    if (acoesAtualizadas > 0) {
      salvarBanco(banco);
      if (vagasModificadas.length > 0) {
        const vagasComLinkValido = vagasModificadas.filter(v => v.link && /^https?:\/\//i.test(v.link));
        if (vagasComLinkValido.length > 0) {
          await upsertVagasSupabase(vagasComLinkValido);
        }
      }
      registrarLog(`Total de ${acoesAtualizadas} atualização(ões) salva(s) no banco de vagas.`);
    } else {
      registrarLog('Nenhuma nova atualização de processo seletivo detectada nesta rodada.');
    }

    const followups = identificarFollowupsPendentes(banco, 21);
    if (followups.length > 0) {
      registrarLog(`Follow-up sugerido (>21 dias sem retorno): ${followups.length} candidatura(s).`);
    }

    cfg.ultimoCheck = new Date().toLocaleString('pt-BR');
    salvarConfig(cfg);

    connection.end();
    return { sucesso: true, acoesAtualizadas, followups };
  } catch (err) {
    registrarLog(`Erro na conexão com Gmail: ${err.message}`);
    return { sucesso: false, erro: err.message };
  }
}

if (require.main === module) {
  verificarCaixaEntrada().then(res => {
    if (!res.sucesso && res.motivo === 'CONFIG_INCOMPLETA') {
      console.log('\n[Dica] Preencha seu email e appPassword no arquivo "email_config.json" para iniciar o monitoramento.');
    }
  });
}

module.exports = { verificarCaixaEntrada, analisarConteudoEmail, identificarFollowupsPendentes };
