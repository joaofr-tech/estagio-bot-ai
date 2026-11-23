from __future__ import annotations

import re
from typing import Any, Literal
from pydantic import BaseModel, Field, field_validator, model_validator


STATUS_VALIDOS = (
    "para_aplicar",
    "em_andamento",
    "aplicada",
    "favorita",
    "encerrada",
    "descartada",
    "acao_pendente",
)


class VagaRecord(BaseModel):
    """Contrato de dados validado via Pydantic v2 para vagas de estágio."""

    id: str = ""
    empresa: str = ""
    cargo: str = ""
    modalidade: str = "Remoto / Híbrido"
    localizacao: str = "Belo Horizonte / Remoto"
    turno: str = "Tarde / Flexível"
    prazo: str = "Inscrições Abertas"
    requisitos: str = "Sem requisitos descritos"
    link: str = ""
    data_coleta: str = ""
    notificada: bool = False
    status: Literal[
        "para_aplicar",
        "em_andamento",
        "aplicada",
        "favorita",
        "encerrada",
        "descartada",
        "acao_pendente",
    ] = "para_aplicar"
    fonte: str = "etl"

    @field_validator("empresa", "cargo", "modalidade", "localizacao", "turno", "prazo", "requisitos", "link", mode="before")
    @classmethod
    def _strip_strings(cls, v: Any) -> str:
        if v is None:
            return ""
        return str(v).strip()

    @field_validator("status", mode="before")
    @classmethod
    def _normalize_status(cls, v: Any) -> str:
        if not v:
            return "para_aplicar"
        s = str(v).strip()
        return s if s in STATUS_VALIDOS else "para_aplicar"

    @field_validator("link")
    @classmethod
    def _validate_link(cls, v: str) -> str:
        if v:
            if v == "#" or not re.match(r"^https?://.+", v, flags=re.IGNORECASE):
                raise ValueError(f'Link inválido (deve iniciar com http:// ou https://): "{v}"')
            if re.search(r"vertexaisearch\.cloud\.google\.com|grounding-api-redirect", v, flags=re.IGNORECASE):
                raise ValueError(f'Link temporário de grounding redirect rejeitado (expira em 404): "{v}"')
        return v

    @model_validator(mode="after")
    def _check_empresa_or_cargo(self) -> "VagaRecord":
        if not self.empresa and not self.cargo:
            raise ValueError("Vaga deve possuir ao menos empresa ou cargo preenchidos")
        if not self.empresa:
            self.empresa = "Empresa Confidencial"
        if not self.cargo:
            self.cargo = "Estágio"
        return self

    def to_supabase_dict(self) -> dict[str, Any]:
        """Retorna payload estritamente compatível com o schema da tabela `vagas` no Supabase."""
        return {
            "id": self.id,
            "empresa": self.empresa,
            "cargo": self.cargo,
            "modalidade": self.modalidade,
            "localizacao": self.localizacao,
            "turno": self.turno,
            "prazo": self.prazo,
            "requisitos": self.requisitos,
            "link": self.link,
            "data_coleta": self.data_coleta,
            "notificada": self.notificada,
            "status": self.status,
        }

    def to_local_dict(self) -> dict[str, Any]:
        """Retorna payload compatível com o cache local banco_vagas.json / dashboard.html."""
        return {
            "id": self.id,
            "empresa": self.empresa,
            "cargo": self.cargo,
            "modalidade": self.modalidade,
            "localizacao": self.localizacao,
            "turno": self.turno,
            "prazo": self.prazo,
            "requisitos": self.requisitos,
            "link": self.link,
            "dataColeta": self.data_coleta,
            "notificada": self.notificada,
            "status": self.status,
            "fonte": self.fonte,
        }


class SourceMetrics(BaseModel):
    status: Literal["ok", "error", "skipped"]
    brutas: int = 0
    latenciaMs: int = 0
    erro: str | None = None


class FunnelMetrics(BaseModel):
    extraidas: int = 0
    duplicadasRodada: int = 0
    jaConhecidas: int = 0
    filtradasMismatch: int = 0
    alertasRevisao: int = 0
    invalidas: int = 0
    ineditas: int = 0


class AuditMetrics(BaseModel):
    verificadas: int = 0
    encerradasCount: int = 0


class PipelineRunTelemetry(BaseModel):
    timestamp: str
    status: str
    isErro: bool = False
    duracaoSegundos: int = 0
    mensagem: str
    vagas: list[dict[str, Any]] = Field(default_factory=list)
    fontes: dict[str, SourceMetrics] = Field(default_factory=dict)
    funil: FunnelMetrics = Field(default_factory=FunnelMetrics)
    auditoria: AuditMetrics = Field(default_factory=AuditMetrics)
