require('esbuild-register');
const nodemailer = require('nodemailer');
const React = require('react');
const { render } = require('@jsx-email/all');
const EmailTemplate = require('./EmailTemplate.jsx').default;
const { obterPendentes, marcarComoNotificadas } = require('./gerenciador_vagas.js');
require('dotenv').config({ path: __dirname + '/.env' });

async function verificarEEnviar() {
  const agora = new Date().toLocaleString('pt-BR');
  console.log(`[${agora}] Verificando vagas acumuladas não enviadas...`);

  const pendentes = obterPendentes();

  if (pendentes.length === 0) {
    console.log("Nenhuma vaga pendente para envio. Caixa de entrada poupada!");
    return;
  }

  console.log(`Encontradas ${pendentes.length} vaga(s) pendente(s). Compilando e-mail...`);

  const emailHtml = await render(React.createElement(EmailTemplate, { vagas: pendentes }));

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
      user: process.env.EMAIL_ADDRESS,
      pass: process.env.EMAIL_PASSWORD,
    },
  });

  const subject = `Novas Vagas de Estágio Encontradas (${pendentes.length})`;

  try {
    const info = await transporter.sendMail({
      from: `"EstágioBot AI" <${process.env.EMAIL_ADDRESS}>`,
      to: process.env.EMAIL_ADDRESS,
      subject: subject,
      html: emailHtml,
    });
    console.log(`E-mail enviado com sucesso! ID: ${info.messageId}`);

    // Marca as vagas no banco como notificadas
    const ids = pendentes.map(v => v.id);
    marcarComoNotificadas(ids);
    console.log(`${ids.length} vaga(s) marcada(s) como notificadas.`);
  } catch (error) {
    console.error("Erro ao enviar e-mail:", error);
  }
}

verificarEEnviar();
