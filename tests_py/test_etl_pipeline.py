from __future__ import annotations

import pytest
from pydantic import ValidationError

from etl.models import VagaRecord
from etl.notifier import rotacionar_log_se_necessario
from etl.repository import detectar_zero_yield_fontes, write_file_atomically
from etl.transform import filtrar_e_transformar, gerar_chave_canonica


def test_vaga_record_pydantic_validation():
    # Rejeita objeto sem empresa nem cargo
    with pytest.raises(ValidationError):
        VagaRecord(empresa="", cargo="", link="https://acme.gupy.io/jobs/1")

    # Rejeita link inválido ou '#'
    with pytest.raises(ValidationError):
        VagaRecord(empresa="Acme", cargo="Estágio Dev", link="#")

    with pytest.raises(ValidationError):
        VagaRecord(empresa="Acme", cargo="Estágio Dev", link="javascript:alert(1)")

    # Aceita e sanitiza vaga válida
    vaga = VagaRecord(
        empresa="  Acme Tech  ",
        cargo="  Estágio Backend Python  ",
        link=" https://acme.gupy.io/jobs/123 ",
    )
    assert vaga.empresa == "Acme Tech"
    assert vaga.cargo == "Estágio Backend Python"
    assert vaga.link == "https://acme.gupy.io/jobs/123"
    assert vaga.status == "para_aplicar"


def test_gerar_chave_canonica_consistente():
    k1 = gerar_chave_canonica("Google Brasil", "Estágio em Engenharia de Software (BH)")
    k2 = gerar_chave_canonica("Google Brasil", "Estagiário de Engenharia de Software - Remoto")
    assert k1 == k2
    assert "google brasil" in k1
    assert "engenharia software" in k1


def test_filtrar_e_transformar_dedup_e_mismatch():
    existentes = [
        {
            "empresa": "Empresa Existente",
            "cargo": "Estágio Python",
            "link": "https://exemplo.com/vagas/1",
        }
    ]
    regras = {"termosNegativos": ["suporte técnico", "helpdesk", "sdr"]}

    lote = [
        {"empresa": "Empresa Existente", "cargo": "Estágio Python", "link": "https://exemplo.com/vagas/1"},
        {"empresa": "Empresa Nova", "cargo": "Estágio Suporte Técnico Helpdesk", "link": "https://exemplo.com/vagas/2"},
        {"empresa": "Empresa Nova", "cargo": "Estágio Engenharia de Dados", "link": "https://exemplo.com/vagas/3"},
        {"empresa": "Empresa Nova", "cargo": "Estágio Engenharia de Dados", "link": "https://exemplo.com/vagas/3"},
        {"empresa": "", "cargo": "", "link": "notaurl"},
    ]

    ineditas, funil = filtrar_e_transformar(lote, existentes, regras)

    assert len(ineditas) == 1
    assert ineditas[0].cargo == "Estágio Engenharia de Dados"
    assert funil.extraidas == 5
    assert funil.jaConhecidas == 1
    assert funil.filtradasMismatch == 1
    assert funil.duplicadasRodada == 1
    assert funil.invalidas == 1
    assert funil.ineditas == 1


def test_write_file_atomically(tmp_path):
    target = tmp_path / "teste.json"
    write_file_atomically(target, '{"ok": true}')
    assert target.read_text(encoding="utf-8") == '{"ok": true}'


def test_detectar_zero_yield_fontes():
    hist_alerta = [
        {"fontes": {"linkedin": {"status": "ok", "brutas": 10}, "catho": {"status": "error", "brutas": 0}}},
        {"fontes": {"linkedin": {"status": "ok", "brutas": 8}, "catho": {"status": "ok", "brutas": 0}}},
        {"fontes": {"linkedin": {"status": "ok", "brutas": 12}, "catho": {"status": "error", "brutas": 0}}},
    ]
    avisos = detectar_zero_yield_fontes(hist_alerta, 3)
    assert len(avisos) == 1
    assert "catho" in avisos[0]

    hist_ok = [
        {"fontes": {"linkedin": {"status": "ok", "brutas": 10}, "catho": {"status": "ok", "brutas": 2}}},
        {"fontes": {"linkedin": {"status": "ok", "brutas": 8}, "catho": {"status": "ok", "brutas": 0}}},
        {"fontes": {"linkedin": {"status": "ok", "brutas": 12}, "catho": {"status": "ok", "brutas": 0}}},
    ]
    assert detectar_zero_yield_fontes(hist_ok, 3) == []


def test_rotacionar_log_se_necessario(tmp_path):
    log_file = tmp_path / "log_execucoes.txt"
    old_file = tmp_path / "log_execucoes.old.txt"
    linhas = "\n".join(f"[Linha {i}] Registro ETL" for i in range(1, 21))
    log_file.write_text(linhas, encoding="utf-8")

    res = rotacionar_log_se_necessario(log_file, max_bytes=150)
    assert res["rotated"] is True
    assert old_file.exists()
    ativo = log_file.read_text(encoding="utf-8")
    assert "[Linha 20]" in ativo
    assert "[Linha 1]" not in ativo


def test_rejeitar_links_temporarios_grounding_redirect():
    from etl.auditor import validar_vaga_ativa

    url_temp = "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQGcRDQ-fake"
    with pytest.raises(ValidationError):
        VagaRecord(empresa="Teste", cargo="Estágio", link=url_temp)

    audit = validar_vaga_ativa({"link": url_temp})
    assert audit["encerrada"] is True


def test_require_cloud_falha_sem_credenciais(monkeypatch, tmp_path):
    from etl import repository
    from etl.models import PipelineRunTelemetry
    from etl.repository import carregar_vagas_atuais, registrar_telemetria, upsert_vagas

    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
    monkeypatch.setattr(repository, "BANCO_PATH", tmp_path / "banco_vagas.json")
    monkeypatch.setattr(repository, "BANCO_JS_PATH", tmp_path / "banco_vagas.js")

    with pytest.raises(RuntimeError, match="Credenciais Supabase obrigatórias ausentes"):
        carregar_vagas_atuais(require_cloud=True)

    vaga = VagaRecord(empresa="Acme", cargo="Estágio Python", link="https://acme.gupy.io/jobs/99")
    with pytest.raises(RuntimeError, match="Credenciais Supabase obrigatórias ausentes"):
        upsert_vagas([vaga], banco_atual=[], require_cloud=True)

    telemetria = PipelineRunTelemetry(timestamp="21/11/2026, 15:00:00", status="SEM_VAGAS", mensagem="Ok")
    with pytest.raises(RuntimeError, match="Credenciais Supabase obrigatórias ausentes"):
        registrar_telemetria(
            telemetria,
            historico_local_path=tmp_path / "historico.js",
            require_cloud=True,
        )


def test_supabase_row_inclui_updated_at():
    from etl.repository import _to_supabase_row

    row = _to_supabase_row(
        {
            "id": "v1",
            "empresa": "Acme",
            "cargo": "Estágio Backend",
            "link": "https://acme.gupy.io/jobs/1",
            "status": "encerrada",
        },
        include_updated_at=True,
    )
    assert "updated_at" in row and "T" in row["updated_at"]
    assert row["status"] == "encerrada"


def test_extratores_ats_e_gupy_mockados(monkeypatch):
    import json
    from etl.extractors import ats, gupy
    from etl.extractors.http_client import HttpResponse

    assert ats.is_estagio_tech("Estágio em Engenharia de Software") is True
    assert ats.is_estagio_tech("Estágio em Suporte Técnico") is False
    assert ats.is_estagio_tech("Desenvolvedor Sênior Python") is False

    gh_payload = json.dumps({
        "jobs": [
            {
                "title": "Estágio em Engenharia de Dados",
                "location": {"name": "Remoto - Brasil"},
                "absolute_url": "https://boards.greenhouse.io/vtex/jobs/12345",
            },
            {
                "title": "Estágio Jurídico",
                "location": {"name": "Belo Horizonte"},
                "absolute_url": "https://boards.greenhouse.io/vtex/jobs/99999",
            },
        ]
    })

    monkeypatch.setattr(ats, "GREENHOUSE_BOARDS", [{"slug": "vtex", "empresa": "VTEX"}])
    monkeypatch.setattr(ats, "INHIRE_TENANTS", [])
    monkeypatch.setattr(
        ats,
        "fetch_with_retry",
        lambda *args, **kwargs: HttpResponse(ok=True, status_code=200, body=gh_payload, final_url="https://boards-api.greenhouse.io"),
    )

    ats_res = ats.extract({"aceitaRemoto": True})
    assert ats_res["ok"] is True
    assert len(ats_res["jobs"]) == 1
    assert ats_res["jobs"][0]["empresa"] == "VTEX"

    gupy_html = (
        '<html><script id="__NEXT_DATA__" type="application/json">'
        + json.dumps({
            "props": {
                "pageProps": {
                    "data": [
                        {
                            "id": 777,
                            "name": "Estágio em Desenvolvimento Backend",
                            "type": "vacancy_type_internship",
                            "careerPageName": "TechBH",
                            "city": "Belo Horizonte",
                            "state": "MG",
                            "isRemoteWork": False,
                            "workplaceType": "hybrid",
                            "jobUrl": "https://techbh.gupy.io/jobs/777",
                        }
                    ]
                }
            }
        })
        + "</script></html>"
    )
    monkeypatch.setattr(
        gupy,
        "fetch_with_retry",
        lambda *args, **kwargs: HttpResponse(ok=True, status_code=200, body=gupy_html, final_url="https://portal.gupy.io"),
    )
    gupy_res = gupy.extract({"cidades": ["Belo Horizonte"], "aceitaRemoto": True})
    assert gupy_res["ok"] is True
    assert len(gupy_res["jobs"]) == 1
    assert gupy_res["jobs"][0]["link"] == "https://techbh.gupy.io/jobs/777"
