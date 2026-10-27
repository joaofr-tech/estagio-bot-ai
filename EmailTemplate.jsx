import React from 'react';
import {
  Html,
  Head,
  Body,
  Container,
  Section,
  Text,
  Link,
  Row,
  Column,
  Preview
} from '@jsx-email/all';

const EmailTemplate = ({ vagas = [], totalNovas = 0, restantesNoDashboard = 0 }) => {
  return (
    <Html>
      <Head />
      <Preview>🎯 Suas Top Vagas Selecionadas • EstágioBot</Preview>
      <Body style={main}>
        <Container style={container}>
          <Text style={brandHeader}>ESTÁGIOBOT AI • CURADORIA EXCLUSIVA</Text>
          <Text style={title}>Top Oportunidades Selecionadas</Text>
          <Text style={subtitle}>
            Filtramos as vagas mais recentes e compatíveis com seu turno da manhã livre. Sem repetições e sem sobrecarga: foque em aplicar nestas oportunidades selecionadas.
          </Text>

          <Section style={tipBox}>
            <Text style={tipText}>
              💡 <strong>Rastreie no Dashboard:</strong> Abra seu painel no computador para usar o <strong>Modo Foco</strong>, copiar pitchs prontos em 1 clique e marcar as vagas que já candidatou!
            </Text>
          </Section>

          <Section style={grid}>
            {vagas.map((vaga, index) => (
              <Row key={index} style={cardRow}>
                <Column style={card}>
                  <Text style={companyName}>{vaga.empresa}</Text>
                  <Text style={jobTitle}>{vaga.cargo}</Text>
                  <Text style={details}>📍 {vaga.modalidade}</Text>
                  {vaga.requisitos ? (
                    <Text style={requirements}>📝 {vaga.requisitos}</Text>
                  ) : null}
                  <Section style={btnContainer}>
                    <Link href={vaga.link} style={button}>
                      Candidatar-se à Vaga ↗
                    </Link>
                  </Section>
                </Column>
              </Row>
            ))}
          </Section>

          {restantesNoDashboard > 0 ? (
            <Text style={restantesText}>
              + {restantesNoDashboard} outra(s) oportunidade(s) catalogada(s) e organizadas no seu Dashboard.
            </Text>
          ) : null}

          <Text style={footer}>
            EstágioBot AI • Filtro anti-repetição ativo • Painel atualizado em tempo real.
          </Text>
        </Container>
      </Body>
    </Html>
  );
};

export default EmailTemplate;

const main = {
  backgroundColor: '#F5F6F5',
  fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",sans-serif',
};

const container = {
  backgroundColor: '#FFFFFF',
  margin: '24px auto',
  padding: '32px 24px',
  borderRadius: '12px',
  border: '1px solid #E2E6E3',
  maxWidth: '600px',
};

const brandHeader = {
  fontSize: '11px',
  fontWeight: '700',
  letterSpacing: '1px',
  color: '#235347',
  textTransform: 'uppercase',
  marginBottom: '4px',
};

const title = {
  fontSize: '22px',
  lineHeight: '1.25',
  fontWeight: '700',
  color: '#192420',
  margin: '4px 0 8px 0',
};

const subtitle = {
  fontSize: '14px',
  lineHeight: '1.5',
  color: '#5C6C65',
  marginBottom: '24px',
};

const grid = {
  width: '100%',
};

const cardRow = {
  marginBottom: '16px',
};

const card = {
  border: '1px solid #E2E6E3',
  borderRadius: '10px',
  padding: '16px',
  backgroundColor: '#FAFBFA',
  width: '100%',
};

const companyName = {
  fontSize: '11px',
  fontWeight: '700',
  textTransform: 'uppercase',
  color: '#235347',
  margin: '0 0 4px 0',
  letterSpacing: '0.5px',
};

const jobTitle = {
  fontSize: '16px',
  fontWeight: '700',
  color: '#192420',
  margin: '0 0 6px 0',
};

const details = {
  fontSize: '13px',
  color: '#5C6C65',
  margin: '4px 0',
};

const requirements = {
  fontSize: '12px',
  color: '#5C6C65',
  margin: '8px 0 16px 0',
  lineHeight: '1.4',
};

const btnContainer = {
  textAlign: 'left',
  marginTop: '12px',
};

const button = {
  backgroundColor: '#235347',
  borderRadius: '6px',
  color: '#FFFFFF',
  fontSize: '13px',
  textDecoration: 'none',
  textAlign: 'center',
  display: 'inline-block',
  padding: '8px 16px',
  fontWeight: '600',
};

const tipBox = {
  backgroundColor: '#F0F7F4',
  border: '1px solid #D1E5DD',
  borderRadius: '8px',
  padding: '12px 16px',
  marginBottom: '20px',
};

const tipText = {
  fontSize: '13px',
  lineHeight: '1.45',
  color: '#1E4338',
  margin: '0',
};

const restantesText = {
  fontSize: '13px',
  color: '#5C6C65',
  textAlign: 'center',
  margin: '16px 0',
  fontStyle: 'italic',
};

const footer = {
  color: '#8A9992',
  fontSize: '11px',
  lineHeight: '16px',
  marginTop: '32px',
  textAlign: 'center',
  borderTop: '1px solid #E2E6E3',
  paddingTop: '16px',
};
