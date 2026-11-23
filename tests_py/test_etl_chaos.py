from __future__ import annotations

import json
from pathlib import Path

from etl.extractors import ats, catho, http_client, jd_fetcher
from etl.extractors.http_client import HttpResponse, detect_silent_block, extract_json_ld_job_postings
from etl.transform import PASS, REJECT, REVIEW, avaliar_screening, filtrar_e_transformar
from scripts import audit_ui, check_pdf_pages


def test_chaos_silent_block_detection():
    # Cloudflare interstitial retornando HTTP 200
    blocked, reason = detect_silent_block(200, "<html><title>Just a moment...</title><div class='cf-browser-verification'></div></html>", "https://alvo.com")
    assert blocked is True
    assert "Cloudflare" in (reason or "")

    # LinkedIn authwall redirect em HTTP 200
    blocked_li, reason_li = detect_silent_block(200, "<html>Join LinkedIn to view</html>", "https://www.linkedin.com/authwall?trk=abc")
    assert blocked_li is True
    assert "LinkedIn" in (reason_li or "")

    # Página normal não deve ser marcada como bloqueada
    ok_blocked, _ = detect_silent_block(200, "<html><body><h1>Estágio em Engenharia de Software</h1></body></html>", "https://empresa.com/vaga")
    assert ok_blocked is False


def test_chaos_retry_after_and_429(monkeypatch):
    sleeps: list[float] = []
    calls = {"n": 0}

    class FakeResp:
        def __init__(self, status_code: int, text: str, headers: dict[str, str]):
            self.status_code = status_code
            self.text = text
            self.headers = headers
            self.url = "https://api.example.com/jobs"

    class FakeClient:
        is_closed = False

        def get(self, url, headers=None, timeout=10.0):
            calls["n"] += 1
            if calls["n"] == 1:
                return FakeResp(429, "Too many requests", {"Retry-After": "2"})
            return FakeResp(200, '{"jobs": []}', {})

    monkeypatch.setattr(http_client, "_get_thread_client", lambda timeout: FakeClient())
    monkeypatch.setattr(http_client.time, "sleep", lambda s: sleeps.append(s))
    monkeypatch.setattr(http_client, "_try_curl_cffi_fallback", lambda *a, **k: None)

    resp = http_client.fetch_with_retry("https://api.example.com/jobs", retries=2, timeout=5.0)
    assert resp.ok is True
    assert calls["n"] == 2
    assert len(sleeps) == 1
    assert 2.0 <= sleeps[0] <= 2.5, "Deve respeitar header Retry-After + jitter"


def test_chaos_json_ld_extraction_and_corrupt_blocks():
    html = """
    <html>
      <script type="application/ld+json">{broken json here</script>
      <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@graph": [
          {"@type": "Organization", "name": "IgnoreMe"},
          {
            "@type": "JobPosting",
            "title": "Estágio Backend Python",
            "hiringOrganization": {"name": "TechMG"},
            "description": "<p>Python e PostgreSQL</p>",
            "jobLocationType": "TELECOMMUTE",
            "url": "https://techmg.com/vagas/1"
          }
        ]
      }
      </script>
    </html>
    """
    postings = extract_json_ld_job_postings(html)
    assert len(postings) == 1
    assert postings[0]["title"] == "Estágio Backend Python"
    assert postings[0]["hiringOrganization"]["name"] == "TechMG"


def test_chaos_catho_json_ld_fallback(monkeypatch):
    catho_html = """
    <html>
      <script type="application/ld+json">
      {"@type": "JobPosting", "title": "Estágio Desenvolvimento Web", "hiringOrganization": {"name": "BH Soft"}, "description": "React e Node", "url": "https://www.catho.com.br/vagas/123/"}
      </script>
    </html>
    """
    monkeypatch.setattr(
        catho,
        "fetch_with_retry",
        lambda *a, **k: HttpResponse(ok=True, status_code=200, body=catho_html, final_url="https://www.catho.com.br"),
    )
    res = catho.extract({"cidades": ["Belo Horizonte"], "estado": "MG"})
    assert res["ok"] is True
    assert len(res["jobs"]) == 1
    assert res["jobs"][0]["empresa"] == "BH Soft"


def test_chaos_screening_negation_wildcards_and_warnings():
    regras = {
        "termosNegativos": ["suporte técnico", "helpdesk", "vend*"],
        "termosAlerta": ["plantão", "on-call", "banco de talentos"],
    }

    # Negação PT-BR: "não é vaga de suporte técnico" não deve descartar — deve virar REVIEW
    r_neg_pt = avaliar_screening("Estágio Backend Python. Atenção: não é vaga de suporte técnico.", regras)
    assert r_neg_pt.verdict == REVIEW
    assert any("negado" in h.term for h in r_neg_pt.hits)

    # Negação EN: "without on-call" / "no helpdesk"
    r_neg_en = avaliar_screening("Software Intern, no helpdesk duties at all.", regras)
    assert r_neg_en.verdict == REVIEW

    # Rejeição real com wildcard ("vendas" bate em "vend*")
    r_rej = avaliar_screening("Estágio em vendas B2B e prospecção", regras)
    assert r_rej.verdict == REJECT
    assert r_rej.hits[0].snippets

    # Alerta sem rejeição
    r_warn = avaliar_screening("Estágio em Engenharia de Software (banco de talentos)", regras)
    assert r_warn.verdict == REVIEW

    # Limpa
    r_ok = avaliar_screening("Estágio em Engenharia de Software com Python, SQL e APIs REST", regras)
    assert r_ok.verdict == PASS

    # Integração com filtrar_e_transformar + payloads hostis (string 10k chars, nulos, unicode)
    lote = [
        None,
        "nao-dict",
        {"empresa": "Boa", "cargo": "Estágio Dev", "requisitos": "Não é suporte técnico. " + ("Python " * 1500), "link": "https://boa.com/1"},
        {"empresa": "Ruim", "cargo": "Estágio Suporte Técnico", "requisitos": "Helpdesk", "link": "https://ruim.com/2"},
    ]
    ineditas, funil = filtrar_e_transformar(lote, [], regras)
    assert len(ineditas) == 1
    assert funil.invalidas == 2
    assert funil.filtradasMismatch == 1
    assert funil.alertasRevisao == 1


def test_chaos_ats_ashby_lever_and_corrupt_json(monkeypatch):
    ashby_payload = json.dumps({
        "jobs": [
            {
                "id": "ash-1",
                "title": "Software Engineering Intern",
                "location": "Remote - Brazil",
                "isRemote": True,
                "descriptionPlain": "Python, TypeScript and SQL.",
            }
        ]
    })
    lever_payload = json.dumps([
        {
            "text": "Estágio em Engenharia de Dados",
            "categories": {"location": "Belo Horizonte, MG"},
            "workplaceType": "hybrid",
            "hostedUrl": "https://jobs.lever.co/dataorg/lev-1",
            "descriptionPlain": "ETL em Python e SQL.",
        }
    ])

    def fake_fetch(url, *args, **kwargs):
        if "ashbyhq.com" in url:
            return HttpResponse(ok=True, status_code=200, body=ashby_payload, final_url=url)
        if "lever.co" in url:
            return HttpResponse(ok=True, status_code=200, body=lever_payload, final_url=url)
        # Simula JSON truncado/corrompido no Greenhouse
        return HttpResponse(ok=True, status_code=200, body='{"jobs": [{"title": "broken', final_url=url)

    monkeypatch.setattr(ats, "GREENHOUSE_BOARDS", [{"slug": "broken", "empresa": "BrokenCo"}])
    monkeypatch.setattr(ats, "INHIRE_TENANTS", [])
    monkeypatch.setattr(ats, "ASHBY_BOARDS", [{"slug": "acme", "empresa": "Acme"}])
    monkeypatch.setattr(ats, "LEVER_BOARDS", [{"slug": "dataorg", "empresa": "DataOrg"}])
    monkeypatch.setattr(ats, "fetch_with_retry", fake_fetch)

    res = ats.extract({"cidades": ["Belo Horizonte"], "aceitaRemoto": True})
    assert res["ok"] is True
    fontes = {j["fonte"] for j in res["jobs"]}
    assert fontes == {"ashby", "lever"}
    assert "Python" in res["jobs"][0]["requisitos"]


def test_chaos_jd_fetcher_identification_and_html_to_text():
    assert jd_fetcher.identify_job_source("https://jobs.ashbyhq.com/linear/abc-123") == ("ashby", "linear", "abc-123")
    assert jd_fetcher.identify_job_source("https://jobs.lever.co/nubank/xyz-999") == ("lever", "nubank", "xyz-999")
    assert jd_fetcher.identify_job_source("https://boards.greenhouse.io/vtex/jobs/555") == ("greenhouse", "vtex", "555")
    assert jd_fetcher.identify_job_source("https://ifood.gupy.io/jobs/9876") == ("gupy", "ifood", "9876")

    clean = jd_fetcher.html_to_text("<div><script>alert(1)</script><h2>Requisitos</h2><ul><li>Python</li><li>SQL</li></ul></div>")
    assert "alert(1)" not in clean
    assert "- Python" in clean
    assert "- SQL" in clean


def test_chaos_ui_audit_and_pdf_page_counter(tmp_path: Path):
    sample_html = tmp_path / "sample.html"
    sample_html.write_text(
        "<div class='eyebrow'>KICKER</div>\n"
        "<button>Gerar 🚀</button>\n"
        "<button>Permitido ✨</button> <!-- sona-allow: A9 -->\n",
        encoding="utf-8",
    )
    findings = audit_ui.audit_paths([str(sample_html)])
    ids = [f["id"] for f in findings]
    assert "A1" in ids
    assert "A9" in ids
    assert len([f for f in findings if f["id"] == "A9"]) == 1, "Deve respeitar sona-allow: A9"

    pdf_1p = tmp_path / "one.pdf"
    pdf_1p.write_bytes(b"%PDF-1.4\n1 0 obj << /Type /Pages /Count 1 >> endobj\n")
    assert check_pdf_pages.page_count(pdf_1p) == 1

    pdf_2p = tmp_path / "two.pdf"
    pdf_2p.write_bytes(b"%PDF-1.4\n1 0 obj << /Type /Pages /Count 2 >> endobj\n")
    assert check_pdf_pages.page_count(pdf_2p) == 2
