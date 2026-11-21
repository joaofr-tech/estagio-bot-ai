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
