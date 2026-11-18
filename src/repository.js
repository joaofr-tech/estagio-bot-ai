const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const BANCO_PATH = path.join(ROOT_DIR, 'banco_vagas.json');
const BANCO_JS_PATH = path.join(ROOT_DIR, 'banco_vagas.js');

const STATUS_VALIDOS = [
  'para_aplicar',
  'em_andamento',
  'aplicada',
  'favorita',
  'encerrada',
  'descartada',
  'acao_pendente'
];

/**
 * Grava arquivo de forma atômica via arquivo temporário + renameSync,
 * com fallback seguro caso o sistema de arquivos do Windows bloqueie a troca.
 */
function writeFileAtomically(filePath, content) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmpPath, content, 'utf8');
    try {
      fs.renameSync(tmpPath, filePath);
    } catch (renameErr) {
      if (renameErr && (renameErr.code === 'EPERM' || renameErr.code === 'EACCES')) {
        fs.writeFileSync(filePath, content, 'utf8');
      } else {
        throw renameErr;
      }
    }
  } finally {
    if (fs.existsSync(tmpPath)) {
      try {
        fs.unlinkSync(tmpPath);
      } catch (e) {}
    }
  }
}

/**
 * Valida contrato de dados e sanitiza um objeto de vaga.
 */
function validarSchemaVaga(vaga, options = {}) {
  const { exigirLink = false } = options;
  const erros = [];

  if (!vaga || typeof vaga !== 'object' || Array.isArray(vaga)) {
    return {
      valida: false,
      erros: ['Vaga deve ser um objeto válido'],
      vagaSanitizada: null
    };
  }

  const empresa = typeof vaga.empresa === 'string' ? vaga.empresa.trim() : '';
  const cargo = typeof vaga.cargo === 'string' ? vaga.cargo.trim() : '';

  if (!empresa && !cargo) {
    erros.push('Vaga deve possuir ao menos empresa ou cargo preenchidos');
  }

  const linkBruto = typeof vaga.link === 'string' ? vaga.link.trim() : '';
  if (exigirLink && !linkBruto) {
    erros.push('Link da vaga é obrigatório');
  } else if (linkBruto) {
    if (linkBruto === '#' || !/^https?:\/\/.+/i.test(linkBruto)) {
      erros.push(`Link inválido (deve iniciar com http:// ou https://): "${linkBruto}"`);
    }
  }

  const statusBruto = typeof vaga.status === 'string' ? vaga.status.trim() : '';
  const status = STATUS_VALIDOS.includes(statusBruto) ? statusBruto : 'para_aplicar';

  const vagaSanitizada = {
    ...vaga,
    empresa: empresa || 'Empresa Confidencial',
    cargo: cargo || 'Estágio',
    link: linkBruto,
    status
  };

  return {
    valida: erros.length === 0,
    erros,
    vagaSanitizada
  };
}

/**
 * Carrega o banco local de vagas com fallback seguro para array vazio.
 */
function carregarBanco() {
  if (!fs.existsSync(BANCO_PATH)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(BANCO_PATH, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

/**
 * Persiste o banco local atomicamente em JSON e no bridge JS para o dashboard offline.
 */
function salvarBanco(banco) {
  const jsonStr = JSON.stringify(banco, null, 2);
  writeFileAtomically(BANCO_PATH, jsonStr);
  writeFileAtomically(BANCO_JS_PATH, `window.BANCO_VAGAS = ${jsonStr};\n`);
}

/**
 * Sincroniza um lote de vagas com o Supabase de forma segura sem quebrar execução offline.
 */
async function sincronizarVagasSupabase(vagas) {
  if (!Array.isArray(vagas) || vagas.length === 0) return false;
  try {
    const { upsertVagasSupabase } = require('../supabase_client');
    if (typeof upsertVagasSupabase !== 'function') return false;
    return await upsertVagasSupabase(vagas);
  } catch (e) {
    console.warn('[Supabase] Falha ao sincronizar vagas:', e.message);
    return false;
  }
}

module.exports = {
  ROOT_DIR,
  BANCO_PATH,
  BANCO_JS_PATH,
  STATUS_VALIDOS,
  writeFileAtomically,
  validarSchemaVaga,
  carregarBanco,
  salvarBanco,
  sincronizarVagasSupabase
};
