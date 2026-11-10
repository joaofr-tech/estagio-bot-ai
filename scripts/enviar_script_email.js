const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const sqlPath = path.join(__dirname, '..', 'schema_supabase.sql');
const sqlContent = fs.readFileSync(sqlPath, 'utf8');

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_ADDRESS,
    pass: process.env.EMAIL_PASSWORD
  }
});

const html = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 650px; margin: 0 auto; padding: 24px; color: #242420; background-color: #f7f6f2; border-radius: 12px; border: 1px solid #d9d7cf;">
  <div style="border-bottom: 2px solid #2f6f4e; padding-bottom: 12px; margin-bottom: 20px;">
    <h2 style="margin: 0; color: #242420; font-size: 22px;">⚡ Script SQL do Supabase — EstágioBot AI</h2>
    <p style="margin: 6px 0 0 0; color: #716f68; font-size: 14px;">Criação da tabela de telemetria e permissões RLS</p>
  </div>

  <p style="font-size: 15px; line-height: 1.6;">Olá, João!</p>
  <p style="font-size: 15px; line-height: 1.6;">Aqui está o script SQL para criar a tabela de histórico de varreduras no seu projeto Supabase. Com ele, o dashboard passa a exibir a telemetria e saúde do crawler em tempo real sem depender do Git.</p>

  <h3 style="margin-top: 24px; font-size: 16px; color: #242420;">Passo a Passo:</h3>
  <ol style="font-size: 14px; line-height: 1.7; padding-left: 20px;">
    <li>Acesse o painel do seu projeto no Supabase (<strong>SQL Editor</strong>).</li>
    <li>Cole e execute o código SQL abaixo (ou use o arquivo <code>schema_supabase.sql</code> em anexo).</li>
    <li>No terminal do projeto no seu computador, execute:
      <pre style="background: #242420; color: #f7f6f2; padding: 10px 14px; border-radius: 6px; font-size: 13px; margin-top: 8px;">node scripts/migrar_historico_supabase.js</pre>
    </li>
  </ol>

  <h3 style="margin-top: 24px; font-size: 16px; color: #242420;">Código SQL para Execução:</h3>
  <div style="background: #242420; color: #f1df7d; padding: 16px; border-radius: 8px; overflow-x: auto; font-family: monospace; font-size: 13px; line-height: 1.5;">
    <pre style="margin: 0; white-space: pre-wrap;">${sqlContent.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
  </div>

  <p style="margin-top: 28px; font-size: 13px; color: #716f68; border-top: 1px solid #d9d7cf; padding-top: 14px;">
    Enviado automaticamente pelo <strong>EstágioBot AI</strong>.
  </p>
</div>
`;

async function enviar() {
  const destinatarios = [process.env.EMAIL_ADDRESS];
  const outroEmail = 'joaofrancisco.murilo1@gmail.com';
  if (outroEmail && !destinatarios.includes(outroEmail)) {
    destinatarios.push(outroEmail);
  }

  console.log(`Enviando script SQL para: ${destinatarios.join(', ')}...`);

  const info = await transporter.sendMail({
    from: `"EstágioBot AI" <${process.env.EMAIL_ADDRESS}>`,
    to: destinatarios.join(', '),
    subject: '⚡ Script SQL Supabase — Telemetria EstágioBot AI',
    html: html,
    attachments: [
      {
        filename: 'schema_supabase.sql',
        content: sqlContent
      }
    ]
  });

  console.log('✅ E-mail enviado com sucesso!');
  console.log('Message ID:', info.messageId);
}

enviar().catch(err => {
  console.error('❌ Erro ao enviar e-mail:', err);
  process.exit(1);
});
