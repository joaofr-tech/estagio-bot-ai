require('esbuild-register');
const path = require('path');
const nodemailer = require('nodemailer');
const React = require('react');
const { render } = require('@jsx-email/all');
const EmailTemplate = require('./EmailTemplate.jsx').default;
const { obterPendentes, marcarComoNotificadas } = require('./gerenciador_vagas.js');
require('dotenv').config({ path: __dirname + '/.env' });

async function dispararResumo() {
  console.log("=========================================");
  console.log(`[${new Date().toLocaleString('pt-BR')}] Verificando vagas pendentes para o Resumo Matinal das 07:15...`);

  const pendentes = obterPendentes();

  if (pendentes.length === 0) {
    console.log("Nenhuma vaga pendente no banco de dados. E-mail poupado com sucesso para não gerar spam!");
    return;
  }

  console.log(`Encontradas ${pendentes.length} vaga(s) inédita(s) acumuladas. Compilando e-mail...`);

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

  const subject = `☕ Resumo Matinal: ${pendentes.length} Nova(s) Vaga(s) de Estágio Encontrada(s)!`;

  try {
    const info = await transporter.sendMail({
      from: `"EstágioBot AI" <${process.env.EMAIL_ADDRESS}>`,
      to: "jf756061@gmail.com",
      subject: subject,
      html: emailHtml,
    });
    console.log(`E-mail de resumo enviado com sucesso! Message ID: ${info.messageId}`);

    // Marca as vagas no banco como notificadas para nunca mais reenviar
    const ids = pendentes.map(v => v.id);
    marcarComoNotificadas(ids);
    console.log(`${ids.length} vaga(s) marcada(s) como notificadas no banco local.`);
  } catch (error) {
    console.error("Erro ao enviar o e-mail de resumo:", error);
  }
}

dispararResumo();
