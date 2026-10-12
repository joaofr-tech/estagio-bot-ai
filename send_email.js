require('esbuild-register');
const fs = require('fs');
const nodemailer = require('nodemailer');
const React = require('react');
const { render } = require('@jsx-email/all');
const EmailTemplate = require('./EmailTemplate.jsx').default;
require('dotenv').config({ path: __dirname + '/.env' });

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error("Uso: node send_email.js <Assunto> <arquivo_vagas.json>");
    process.exit(1);
  }

  const subject = args[0];
  const jsonFile = args[1];

  let vagas = [];
  try {
    const data = fs.readFileSync(jsonFile, 'utf8');
    vagas = JSON.parse(data);
  } catch (err) {
    console.error("Erro ao ler JSON de vagas:", err);
    process.exit(1);
  }

  const emailHtml = await render(React.createElement(EmailTemplate, { vagas }));

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false, // true for 465, false for other ports
    auth: {
      user: process.env.EMAIL_ADDRESS,
      pass: process.env.EMAIL_PASSWORD,
    },
  });

  try {
    const info = await transporter.sendMail({
      from: `"Agente de Vagas" <${process.env.EMAIL_ADDRESS}>`,
      to: "jf756061@gmail.com",
      subject: subject,
      html: emailHtml,
    });
    console.log("E-mail enviado com sucesso: %s", info.messageId);
  } catch (error) {
    console.error("Erro ao enviar e-mail:", error);
  }
}

main();
