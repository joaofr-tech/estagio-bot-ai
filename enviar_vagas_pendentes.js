require('esbuild-register');
const nodemailer = require('nodemailer');
const React = require('react');
const { render } = require('@jsx-email/all');
const EmailTemplate = require('./EmailTemplate.jsx').default;
const { obterPendentes, marcarComoNotificadas } = require('./gerenciador_vagas.js');
require('dotenv').config({ path: __dirname + '/.env' });

const MAX_VAGAS_POR_EMAIL = 5;

async function verificarEEnviar() {
  const agora = new Date().toLocaleString('pt-BR');
  console.log(`[${agora}] Verificando vagas acumuladas não enviadas...`);

  const todasPendentes = obterPendentes();

  if (todasPendentes.length === 0) {
    console.log("Nenhuma vaga pendente para envio. Caixa de entrada poupada!");
    return;
  }

  // Limitar o e-mail às Top 5 vagas mais recentes para evitar sobrecarga
  const vagasParaEnviar = todasPendentes.slice(0, MAX_VAGAS_POR_EMAIL);
  const restantes = todasPendentes.length - vagasParaEnviar.length;

  console.log(`Encontradas ${todasPendentes.length} vaga(s) pendente(s). Selecionando ${vagasParaEnviar.length} para o digest...`);

  const emailHtml = await render(React.createElement(EmailTemplate, { 
    vagas: vagasParaEnviar,
    totalNovas: todasPendentes.length,
    restantesNoDashboard: restantes
  }));

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
      user: process.env.EMAIL_ADDRESS,
      pass: process.env.EMAIL_PASSWORD,
    },
  });

  const subject = `🎯 Top Oportunidades de Estágio Selecionadas (${vagasParaEnviar.length})`;

  try {
    const info = await transporter.sendMail({
      from: `"EstágioBot AI" <${process.env.EMAIL_ADDRESS}>`,
      to: process.env.EMAIL_ADDRESS,
      subject: subject,
      html: emailHtml,
    });
    console.log(`E-mail enviado com sucesso! ID: ${info.messageId}`);

    // Marca as vagas enviadas como notificadas
    const ids = vagasParaEnviar.map(v => v.id);
    marcarComoNotificadas(ids);
    console.log(`${ids.length} vaga(s) marcada(s) como notificadas.`);
  } catch (error) {
    console.error("Erro ao enviar e-mail:", error);
  }
}

verificarEEnviar();
