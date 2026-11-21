"""
Suíte de Testes E2E (Playwright) — Sona Dashboard + Sona Resume Studio
Testa o fluxo real no navegador (headless Chromium), layout visual (.dropzone, sidebar embutida),
deduplicação do Banco de Fatos, Seletor Inteligente do GitHub, Template modelo-cv.docx e Editor WYSIWYG.
"""

from __future__ import annotations

import json
import os
import subprocess
import time
import urllib.request
from pathlib import Path

import pytest

playwright_sync = pytest.importorskip("playwright.sync_api")
sync_playwright = playwright_sync.sync_playwright

ROOT_DIR = Path(__file__).resolve().parent.parent
TEST_PORT = 3917
BASE_URL = f"http://127.0.0.1:{TEST_PORT}"


@pytest.fixture(scope="module")
def local_server():
    env = os.environ.copy()
    env["PORT"] = str(TEST_PORT)
    proc = subprocess.Popen(
        ["node", "servidor.js"],
        cwd=str(ROOT_DIR),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    # Aguarda o servidor subir
    deadline = time.time() + 10
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(f"{BASE_URL}/dashboard.html", timeout=1) as resp:
                if resp.status == 200:
                    break
        except Exception:
            time.sleep(0.25)
    else:
        proc.terminate()
        raise RuntimeError("servidor.js não respondeu a tempo para os testes E2E.")

    yield BASE_URL
    proc.terminate()
    try:
        proc.wait(timeout=5)
    except Exception:
        proc.kill()


MOCK_GH_LIST_RESPONSE = {
    "ok": True,
    "username": "joaofrancisco",
    "total_found": 3,
    "repos": [
        {
            "id": 101,
            "name": "Estagio_Bot",
            "full_name": "joaofrancisco/Estagio_Bot",
            "url": "https://github.com/joaofrancisco/Estagio_Bot",
            "description": "Pipeline ETL de vagas em Python + Supabase e Resume Studio ATS",
            "language": "Python",
            "topics": ["python", "etl", "supabase"],
            "stars": 5,
            "size": 450,
            "pushed_at": "2026-11-18T12:00:00Z",
            "score": 15,
            "recommended": True,
            "noise_reason": "",
        },
        {
            "id": 102,
            "name": "TaskFlow-API",
            "full_name": "joaofrancisco/TaskFlow-API",
            "url": "https://github.com/joaofrancisco/TaskFlow-API",
            "description": "API REST em Node.js com PostgreSQL",
            "language": "JavaScript",
            "topics": ["nodejs", "sql"],
            "stars": 2,
            "size": 210,
            "pushed_at": "2026-10-10T12:00:00Z",
            "score": 11,
            "recommended": True,
            "noise_reason": "",
        },
        {
            "id": 103,
            "name": "readme-template",
            "full_name": "joaofrancisco/readme-template",
            "url": "https://github.com/joaofrancisco/readme-template",
            "description": "",
            "language": "",
            "topics": [],
            "stars": 0,
            "size": 5,
            "pushed_at": "2026-11-19T12:00:00Z",
            "score": -8,
            "recommended": False,
            "noise_reason": "Template / Auxiliar",
        },
    ],
}

MOCK_GH_IMPORT_RESPONSE = {
    "ok": True,
    "username": "joaofrancisco",
    "total_imported": 2,
    "projects": [
        {
            "id": "gh-101",
            "name": "Estagio_Bot",
            "repo_full_name": "joaofrancisco/Estagio_Bot",
            "url": "https://github.com/joaofrancisco/Estagio_Bot",
            "languages": ["Python", "JavaScript"],
            "verified_skills": ["Python", "Supabase", "PostgreSQL"],
            "readme_summary": "Pipeline ETL em Python com Supabase e painel web.",
            "facts": [
                "Desenvolveu coletores paralelos em Python para 5 portais de vagas.",
                "Persistência idempotente em PostgreSQL via Supabase.",
            ],
            "source": "github",
        },
        {
            "id": "gh-102",
            "name": "TaskFlow-API",
            "repo_full_name": "joaofrancisco/TaskFlow-API",
            "url": "https://github.com/joaofrancisco/TaskFlow-API",
            "languages": ["JavaScript", "SQL"],
            "verified_skills": ["Node.js", "SQL"],
            "readme_summary": "API REST em Node.js e SQL.",
            "facts": ["Implementou rotas REST em Node.js com testes automatizados."],
            "source": "github",
        },
    ],
    "detected_skills": ["Python", "JavaScript", "Supabase", "PostgreSQL", "Node.js", "SQL"],
}

MOCK_GENERATE_RESPONSE = {
    "ok": True,
    "idioma": "pt-BR",
    "match_report": {
        "target_role": "Estagiário de Engenharia de Software",
        "ats_keywords": ["Python", "SQL", "Automação", "Git"],
        "direct_matches": ["Python", "SQL", "PostgreSQL"],
        "terminological_matches": [
            {
                "jd_term": "Automação de Processos",
                "candidate_evidence": "Coletores paralelos em Python para 5 portais",
                "safe_framing": "Automação de ingestão e validação de dados em Python",
            }
        ],
        "excluded_gaps": ["Power BI", "Kubernetes"],
        "fit_summary": "Boa aderência em Python e banco de dados; gaps reais excluídos com transparência.",
        "selected_project_ids": ["gh-101"],
    },
    "audit_report": {
        "status": "verified_clean",
        "total_bullets_checked": 3,
        "corrections": [],
        "guardrails": {
            "blocked_skills": [],
            "gap_violations": [],
            "cross_project_warnings": [],
            "education_restored": False,
        },
    },
    "resume_json": {
        "idioma": "pt-BR",
        "target_role": "Estagiário de Engenharia de Software",
        "basics": {
            "name": "João Francisco",
            "email": "joao@exemplo.com",
            "phone": "+55 31 99999-0000",
            "location": "Belo Horizonte, MG, Brasil",
            "linkedin": "https://linkedin.com/in/joaofrancisco",
            "github": "https://github.com/joaofrancisco",
        },
        "summary": "Estudante de Engenharia de Software com experiência prática em Python, automação de dados e SQL.",
        "experiences": [
            {
                "id": "exp-mon",
                "company": "PUC Minas",
                "role": "Monitor de Algoritmos e Estruturas de Dados",
                "location": "Belo Horizonte, MG",
                "start_date": "02/2026",
                "end_date": "Atual",
                "bullets": [
                    {"text": "Apoiou estudantes na resolução de exercícios de lógica e estruturas de dados."}
                ],
            }
        ],
        "projects": [
            {
                "id": "gh-101",
                "name": "Estagio_Bot",
                "url": "https://github.com/joaofrancisco/Estagio_Bot",
                "tech_stack": ["Python", "PostgreSQL", "Supabase"],
                "bullets": [
                    {"text": "Desenvolveu coletores paralelos em Python para 5 portais de vagas."},
                    {"text": "Implementou carga idempotente em PostgreSQL via Supabase."},
                ],
            }
        ],
        "education": [
            {
                "id": "edu-puc",
                "institution": "PUC Minas",
                "degree": "Bacharelado em Engenharia de Software",
                "field": "3º período",
                "start_date": "2025",
                "end_date": "2028",
            }
        ],
        "skills_grouped": [
            {"category": "Linguagens", "items": ["Python", "JavaScript", "SQL"]},
            {"category": "Banco de Dados", "items": ["PostgreSQL", "Supabase"]},
        ],
        "certifications": [
            {"id": "cert-1", "name": "Python para Engenharia de Dados", "authority": "Alura", "date": "2026"}
        ],
        "languages_spoken": [
            {"name": "Português", "proficiency": "nativo"},
            {"name": "Inglês", "proficiency": "intermediário"},
        ],
    },
}


def _launch_browser(p):
    for kwargs in ({"headless": True, "channel": "chrome"}, {"headless": True, "channel": "msedge"}, {"headless": True}):
        try:
            return p.chromium.launch(**kwargs)
        except Exception:
            continue
    raise RuntimeError("Nenhum navegador Chromium/Chrome/Edge disponível para Playwright.")


def test_e2e_sona_full_flow(local_server):
    page_errors = []

    with sync_playwright() as p:
        browser = _launch_browser(p)
        context = browser.new_context(viewport={"width": 1440, "height": 900})
        page = context.new_page()
        page.on("pageerror", lambda err: page_errors.append(str(err)))

        # Intercepta APIs externas para execução determinística e rápida
        def route_api(route):
            url = route.request.url
            if "/api/github-sync" in url:
                body = json.loads(route.request.post_data or "{}")
                payload = MOCK_GH_LIST_RESPONSE if body.get("action") == "list" else MOCK_GH_IMPORT_RESPONSE
                route.fulfill(status=200, content_type="application/json", body=json.dumps(payload))
                return
            if "/api/generate-resume" in url:
                route.fulfill(status=200, content_type="application/json", body=json.dumps(MOCK_GENERATE_RESPONSE))
                return
            route.continue_()

        context.route("**/api/**", route_api)

        # 1. Pré-popula localStorage com chave BYOK + duplicatas propositais para testar deduplicação
        page.goto(f"{local_server}/dashboard.html", wait_until="domcontentloaded")
        page.evaluate(
            """() => {
                localStorage.setItem('sona_byok_config_v1', JSON.stringify({
                    provider: 'gemini',
                    model: 'gemini-3.8-flash',
                    apiKey: 'AIza-mock-test-key'
                }));
                localStorage.setItem('sona_master_profile_v1', JSON.stringify({
                    basics: { name: 'João Francisco', email: 'joao@exemplo.com', location: 'Belo Horizonte, MG' },
                    education: [
                        { id: 'e1', institution: 'PUC Minas', degree: 'Bacharelado em Engenharia de Software', start_date: '2025', end_date: '2028', source: 'linkedin_pdf' },
                        { id: 'e2', institution: 'Pontifícia Universidade Católica de Minas Gerais', degree: 'Engenharia de Software', start_date: '2025', end_date: '2028', source: 'base_resume_pdf' }
                    ],
                    experiences: [
                        { id: 'x1', company: 'PUC Minas', role: 'Monitor de AED', start_date: '02/2026', end_date: 'Atual', facts: ['Ajudava alunos em C'], source: 'linkedin_pdf' },
                        { id: 'x2', company: 'Pontifícia Universidade Católica de Minas Gerais', role: 'Monitoria de AED', start_date: '02/2026', end_date: 'Atual', facts: ['Plantão de dúvidas semanal'], source: 'base_resume_pdf' }
                    ],
                    projects: [],
                    skills_whitelist: ['Python', 'SQL', 'PostgreSQL', 'Supabase'],
                    certifications: [{ id: 'c1', name: 'Python para Engenharia de Dados', authority: 'Alura', date: '2026', source: 'linkedin_pdf' }],
                    languages_spoken: [{ name: 'Português', proficiency: 'nativo' }, { name: 'Inglês', proficiency: 'intermediário' }]
                }));
            }"""
        )
        page.reload(wait_until="domcontentloaded")
        page.wait_for_selector("#table-focus-jobs .focus-card", timeout=8000)

        # 2. Valida separação Meta do Dia (+ Candidaturas) vs Todas as Vagas
        assert page.locator("#screen-view-01").is_visible()
        assert not page.locator("#screen-view-02").is_visible()
        assert page.locator("#table-focus-jobs .focus-card").count() == 3
        assert page.locator("#table-candidaturas").is_visible()
        assert page.locator("#btn-subtab-andamento.active").is_visible()

        # Troca para Tela 02 (Todas as Vagas) e valida catálogo isolado
        page.click("#nav-btn-02")
        assert page.locator("#screen-view-02").is_visible()
        assert not page.locator("#screen-view-01").is_visible()
        assert page.locator("#table-all-open-jobs .job-row").count() > 0

        # Volta para Meta do Dia e inicia candidatura em 1 vaga (separado de "Ver Vaga")
        page.click("#nav-btn-01")
        page.evaluate("window.open = () => null;")
        assert page.locator("#table-focus-jobs .focus-card button:has-text('Ver Vaga')").count() == 3
        page.locator("#table-focus-jobs .focus-card button:has-text('Iniciar Candidatura')").first.click()

        # Confirma que a vaga apareceu imediatamente abaixo em "Em Andamento" com botão literal "Gerar Currículo"
        btn_ats = page.locator("#table-candidaturas button:has-text('Gerar Currículo')").first
        btn_ats.wait_for(state="visible", timeout=5000)

        # Salva screenshot da tela Meta do Dia (Obsidian Luxury)
        scratch_dir = Path(r"C:\Users\João\.gemini\antigravity-cli\brain\56da99eb-ec7b-405a-9885-5f739f90e5db\scratch")
        scratch_dir.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(scratch_dir / "e2e_01_meta_do_dia.png"))

        # Valida tela Insights com cards proporcionais + gráficos SVG + barra de filtros
        page.click("#nav-btn-05")
        page.wait_for_selector("#insights-visual-cards .insight-card", timeout=5000)
        assert page.locator("#insights-visual-cards .insight-card").count() == 4
        page.screenshot(path=str(scratch_dir / "e2e_02_insights.png"))

        # Valida tela Parâmetros do crawler (Obsidian) + Configurações separada
        page.click("#nav-btn-04")
        assert page.locator("#screen-view-04").is_visible()
        page.screenshot(path=str(scratch_dir / "e2e_04_parametros_crawler.png"))
        page.click("#nav-btn-07")
        assert page.locator("#screen-view-07").is_visible()

        # Volta para Meta do Dia e clica em "Gerar currículo" → abre Estúdio embutido SEM sidebar duplicada + auto-gera!
        page.click("#nav-btn-01")
        btn_ats.click()
        assert page.locator("#screen-view-06").is_visible()
        frame = page.frame_locator("#sona-studio-frame")
        frame.locator("#btn-generate-ats:has-text('Regerar')").wait_for(state="visible", timeout=8000)

        # Sidebar própria do Studio deve estar oculta no modo embutido
        assert not frame.locator(".studio-sidebar").is_visible()

        # Valida ordem exata das 7 seções do template modelo-cv.docx
        section_titles = frame.locator("#ats-resume-sheet .ats-section-title").all_inner_texts()
        assert section_titles == [
            "RESUMO",
            "EXPERIÊNCIA PROFISSIONAL",
            "PROJETOS",
            "FORMAÇÃO",
            "HABILIDADES",
            "CERTIFICAÇÕES",
            "IDIOMAS",
        ], f"Ordem inesperada de seções: {section_titles}"

        # Análise de aderência começa recolhida e abre via menu "•••"
        assert not frame.locator("#drawer-analysis").is_visible()
        page.screenshot(path=str(scratch_dir / "e2e_03_studio_limpo.png"))
        frame.locator("#btn-studio-more").click()
        frame.locator("#btn-open-analysis").click()
        frame.locator("#transparency-content").wait_for(state="visible", timeout=3000)
        assert "Python" in frame.locator("#list-direct-matches").inner_text()
        assert "Power BI" in frame.locator("#list-excluded-gaps").inner_text()
        frame.locator("#drawer-analysis button:has-text('Fechar')").click()

        # 4. Navega via sidebar principal do Sona para "Configurar fontes" (postMessage instantâneo)
        page.click("#nav-btn-06-onboarding")
        frame.locator("#view-onboarding.active").wait_for(state="visible", timeout=5000)

        # Passo 1: Gemini 3.8 Flash padrão e sem 2.5
        options_text = frame.locator("#byok-model-select").inner_text()
        assert "3.8 Flash" in options_text
        assert "2.5" not in options_text

        # Passo 2: Seletor Inteligente do GitHub (carrega todos, pré-seleciona reais, desmarca template)
        frame.locator("#pill-step-2").click()
        frame.locator("#gh-username").fill("joaofrancisco")
        frame.locator("#btn-list-gh").click()
        frame.locator("#gh-repo-picker").wait_for(state="visible", timeout=5000)
        assert frame.locator(".repo-pick-card.selected").count() == 2
        assert frame.locator(".repo-pick-card.is-noise:not(.selected)").count() == 1
        frame.locator("#btn-sync-gh").click()
        frame.locator("#gh-status-msg:has-text('2 projetos selecionados importados')").wait_for(timeout=5000)

        # Passo 3 & Passo 4: verifica geometria das .dropzone (sem quebra visual!)
        frame.locator("#pill-step-3").click()
        zip_box = frame.locator("label[for='input-linkedin-zip']").bounding_box()
        pdf_box = frame.locator("label[for='input-linkedin-pdf']").bounding_box()
        assert zip_box and zip_box["width"] > 220 and zip_box["height"] > 65, f"Dropzone ZIP quebrada: {zip_box}"
        assert pdf_box and pdf_box["width"] > 220 and pdf_box["height"] > 65, f"Dropzone PDF quebrada: {pdf_box}"

        frame.locator("#pill-step-4").click()
        base_box = frame.locator("label[for='input-base-pdf']").bounding_box()
        assert base_box and base_box["width"] > 350 and base_box["height"] > 65, f"Dropzone Base quebrada: {base_box}"

        # 5. Navega para "Banco de fatos" e valida deduplicação + Certificados + Idiomas
        page.click("#nav-btn-06-profile")
        frame.locator("#view-profile.active").wait_for(state="visible", timeout=5000)
        assert frame.locator("#mp-education-list .fact-item-card").count() == 1, "Graduação não deve duplicar"
        assert frame.locator("#mp-experiences-list .fact-item-card").count() == 1, "Monitoria não deve duplicar"
        assert frame.locator("#mp-projects-list .fact-item-card").count() == 2
        assert frame.locator("#mp-certifications-list .fact-item-card").count() == 1
        assert frame.locator("#mp-languages-list .fact-item-card").count() == 2

        # 6. Volta para "Estúdio de currículo" e testa Editor WYSIWYG (+ Do banco, + Bullet, Desfazer, Preview limpo, Salvar)
        page.click("#nav-btn-06-studio")
        frame.locator("#view-studio.active").wait_for(state="visible", timeout=5000)

        # Adiciona 2º projeto do Banco de Fatos em 1 clique
        frame.locator("button:has-text('+ Do banco')").click()
        frame.locator("#sheet-project-bank-picker button:has-text('+ TaskFlow-API')").click()
        assert frame.locator("#sheet-projects-list .ats-entry").count() == 2

        # Adiciona bullet no 1º projeto
        bullets_before = frame.locator("#sheet-projects-list .ats-entry").first.locator("li").count()
        frame.locator("#sheet-projects-list .ats-entry").first.locator("button:has-text('+ Bullet')").click()
        assert frame.locator("#sheet-projects-list .ats-entry").first.locator("li").count() == bullets_before + 1

        # Desfazer restaura quantidade anterior de bullets (via menu •••)
        frame.locator("#btn-studio-more").click()
        frame.locator("#btn-undo-edit").click()
        assert frame.locator("#sheet-projects-list .ats-entry").first.locator("li").count() == bullets_before

        # Preview limpo esconde controles de edição (via menu •••)
        frame.locator("#btn-studio-more").click()
        frame.locator("#btn-toggle-edit").click()
        assert not frame.locator("button:has-text('+ Do banco')").is_visible()
        frame.locator("#btn-studio-more").click()
        frame.locator("#btn-toggle-edit").click()
        assert frame.locator("button:has-text('+ Do banco')").is_visible()

        # Histórico salvo acessível via menu •••
        frame.locator("#btn-studio-more").click()
        frame.locator("button:has-text('Histórico de Versões')").click()
        assert frame.locator("#resume-history-list .history-item").count() >= 1

        browser.close()

    assert page_errors == [], f"Erros JS encontrados no console: {page_errors}"
