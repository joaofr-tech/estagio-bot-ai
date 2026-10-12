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

const EmailTemplate = ({ vagas = [] }) => {
  return (
    <Html>
      <Head />
      <Preview>Novas Vagas de Estágio (Atualizadas)</Preview>
      <Body style={main}>
        <Container style={container}>
          <Text style={title}>🚀 Novas Vagas Encontradas!</Text>
          <Text style={subtitle}>
            Aqui estão as oportunidades fresquinhas de desenvolvimento e dados que separamos para você hoje.
          </Text>

          <Section style={grid}>
            {vagas.map((vaga, index) => (
              <Row key={index} style={cardRow}>
                <Column style={card}>
                  <Text style={companyName}>{vaga.empresa}</Text>
                  <Text style={jobTitle}>{vaga.cargo}</Text>
                  <Text style={details}>📍 {vaga.modalidade}</Text>
                  <Text style={requirements}>📝 {vaga.requisitos}</Text>
                  <Section style={btnContainer}>
                    <Link href={vaga.link} style={button}>
                      Ver Vaga
                    </Link>
                  </Section>
                </Column>
              </Row>
            ))}
          </Section>

          <Text style={footer}>
            Automatizado com carinho pelo seu Agente de Vagas.
          </Text>
        </Container>
      </Body>
    </Html>
  );
};

export default EmailTemplate;

const main = {
  backgroundColor: '#f6f9fc',
  fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Ubuntu,sans-serif',
};

const container = {
  backgroundColor: '#ffffff',
  margin: '0 auto',
  padding: '20px 0 48px',
  marginBottom: '64px',
  borderRadius: '8px',
  boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
};

const title = {
  fontSize: '24px',
  lineHeight: '1.25',
  fontWeight: '700',
  color: '#333',
  padding: '0 24px',
};

const subtitle = {
  fontSize: '16px',
  lineHeight: '1.5',
  color: '#555',
  padding: '0 24px',
  marginBottom: '24px',
};

const grid = {
  padding: '0 24px',
};

const cardRow = {
  marginBottom: '16px',
};

const card = {
  border: '1px solid #eaeaea',
  borderRadius: '8px',
  padding: '16px',
  backgroundColor: '#fafafa',
  width: '100%',
};

const companyName = {
  fontSize: '12px',
  fontWeight: '600',
  textTransform: 'uppercase',
  color: '#888',
  margin: '0',
};

const jobTitle = {
  fontSize: '18px',
  fontWeight: 'bold',
  color: '#111',
  marginTop: '4px',
  marginBottom: '8px',
};

const details = {
  fontSize: '14px',
  color: '#444',
  margin: '4px 0',
};

const requirements = {
  fontSize: '13px',
  color: '#666',
  margin: '8px 0 16px 0',
  lineHeight: '1.4',
};

const btnContainer = {
  textAlign: 'left',
};

const button = {
  backgroundColor: '#000000',
  borderRadius: '4px',
  color: '#fff',
  fontSize: '14px',
  textDecoration: 'none',
  textAlign: 'center',
  display: 'inline-block',
  padding: '10px 16px',
  fontWeight: 'bold',
};

const footer = {
  color: '#8898aa',
  fontSize: '12px',
  lineHeight: '16px',
  marginTop: '24px',
  textAlign: 'center',
  padding: '0 24px',
};
