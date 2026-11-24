from __future__ import annotations

import html as html_lib
import json
import re
from dataclasses import asdict, dataclass
from html.parser import HTMLParser
from typing import Any
from urllib.parse import urlparse

from .http_client import extract_json_ld_job_postings, fetch_with_retry

BLOCK_TAGS = {
    "p", "div", "br", "li", "ul", "ol",
    "h1", "h2", "h3", "h4", "h5", "h6",
    "tr", "section", "article",
}
SKIP_TAGS = {"script", "style", "noscript", "svg", "head"}


@dataclass
class JobPostingDetail:
    url: str
    source: str
    company: str = ""
    title: str = ""
    location: str = ""
    workplace: str = ""
    employment: str = ""
    compensation: str = ""
    description: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class _TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.chunks: list[str] = []
        self.skip = 0
        self.title = ""
        self._in_title = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "title":
            self._in_title = True
        if tag in SKIP_TAGS:
            self.skip += 1
        if tag in BLOCK_TAGS:
            self.chunks.append("\n")
        if tag == "li":
            self.chunks.append("- ")

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self._in_title = False
        if tag in SKIP_TAGS and self.skip:
            self.skip -= 1
        if tag in BLOCK_TAGS:
            self.chunks.append("\n")

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self.title += data
        if not self.skip:
            self.chunks.append(data)


def html_to_text(markup: str) -> str:
    """Converte HTML em texto legível preservando parágrafos e listas (stdlib pura)."""
    if not markup:
        return ""
    parser = _TextExtractor()
    parser.feed(markup)
    text = "".join(parser.chunks)
    text = re.sub(r"[ \t\r\f\v]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def identify_job_source(url: str) -> tuple[str, str, str]:
    """Identifica o ATS/portal de uma URL de vaga (Ashby, Lever, Greenhouse, Gupy, LinkedIn ou web)."""
    parsed = urlparse(url if "://" in url else f"https://{url}")
    host = parsed.netloc.lower()
    parts = [p for p in parsed.path.split("/") if p]

    if host == "jobs.ashbyhq.com" and len(parts) >= 2:
        return "ashby", parts[0], parts[1]
    if host in {"jobs.lever.co", "jobs.eu.lever.co"} and len(parts) >= 2:
        return "lever", parts[0], parts[1]
    if host.endswith("greenhouse.io") and "jobs" in parts:
        idx = parts.index("jobs")
        if idx >= 1 and idx + 1 < len(parts):
            return "greenhouse", parts[idx - 1], parts[idx + 1]
    if host.endswith(".gupy.io") and "jobs" in parts:
        idx = parts.index("jobs")
        if idx + 1 < len(parts):
            return "gupy", host.split(".")[0], parts[idx + 1]
    if "linkedin.com" in host and "view" in parts:
        m = re.search(r"(\d{8,12})", parsed.path)
        if m:
            return "linkedin", "linkedin", m.group(1)
    return "web", host, parsed.path


def _fetch_ashby(url: str, org: str, job_id: str) -> JobPostingDetail:
    resp = fetch_with_retry(
        f"https://api.ashbyhq.com/posting-api/job-board/{org}?includeCompensation=true",
        headers={"Accept": "application/json"},
        retries=1,
        timeout=10.0,
    )
    if not resp.ok:
        raise RuntimeError(f"Falha ao buscar Ashby ({org}): {resp.error}")
    board = json.loads(resp.body)
    job = next((j for j in board.get("jobs", []) if str(j.get("id")) == str(job_id)), None)
    if not job:
        raise RuntimeError(f"Vaga Ashby {job_id} não encontrada no board público '{org}'")
    comp = (job.get("compensation") or {}).get("compensationTierSummary") or ""
    return JobPostingDetail(
        url=url,
        source="ashby",
        company=org,
        title=job.get("title", ""),
        location=job.get("location", ""),
        workplace=job.get("workplaceType") or ("Remote" if job.get("isRemote") else ""),
        employment=job.get("employmentType", ""),
        compensation=comp,
        description=job.get("descriptionPlain") or html_to_text(job.get("descriptionHtml", "")),
    )


def _fetch_lever(url: str, org: str, job_id: str) -> JobPostingDetail:
    resp = fetch_with_retry(
        f"https://api.lever.co/v0/postings/{org}/{job_id}?mode=json",
        headers={"Accept": "application/json"},
        retries=1,
        timeout=10.0,
    )
    if not resp.ok:
        raise RuntimeError(f"Falha ao buscar Lever ({org}): {resp.error}")
    job = json.loads(resp.body)
    cats = job.get("categories") or {}
    sections = [job.get("descriptionPlain", "")]
    for block in job.get("lists") or []:
        sections.append(f"{block.get('text', '')}\n{html_to_text(block.get('content', ''))}")
    sections.append(job.get("additionalPlain", ""))
    salary = job.get("salaryRange") or {}
    comp = ""
    if salary.get("min"):
        comp = f"{salary.get('currency', '')} {salary['min']}-{salary.get('max', '')} {salary.get('interval', '')}".strip()
    return JobPostingDetail(
        url=url,
        source="lever",
        company=org,
        title=job.get("text", ""),
        location=cats.get("location", ""),
        workplace=job.get("workplaceType", ""),
        employment=cats.get("commitment", ""),
        compensation=comp,
        description="\n\n".join(s.strip() for s in sections if s and s.strip()),
    )


def _fetch_greenhouse(url: str, org: str, job_id: str) -> JobPostingDetail:
    resp = fetch_with_retry(
        f"https://boards-api.greenhouse.io/v1/boards/{org}/jobs/{job_id}",
        headers={"Accept": "application/json"},
        retries=1,
        timeout=10.0,
    )
    if not resp.ok:
        raise RuntimeError(f"Falha ao buscar Greenhouse ({org}): {resp.error}")
    job = json.loads(resp.body)
    return JobPostingDetail(
        url=url,
        source="greenhouse",
        company=org,
        title=job.get("title", ""),
        location=(job.get("location") or {}).get("name", ""),
        description=html_to_text(html_lib.unescape(job.get("content", ""))),
    )


def _fetch_linkedin(url: str, job_id: str) -> JobPostingDetail:
    resp = fetch_with_retry(
        f"https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/{job_id}",
        retries=1,
        timeout=10.0,
    )
    if not resp.ok:
        raise RuntimeError(f"Falha ao buscar LinkedIn ({job_id}): {resp.error}")
    title_m = re.search(r"<h2[^>]*top-card-layout__title[^>]*>([\s\S]*?)</h2>", resp.body, re.I)
    comp_m = re.search(r"topcard__org-name-link[^>]*>([\s\S]*?)</a>", resp.body, re.I)
    loc_m = re.search(r"topcard__flavor--bullet[^>]*>([\s\S]*?)</span>", resp.body, re.I)
    desc_m = re.search(r"show-more-less-html__markup[^>]*>([\s\S]*?)</div>", resp.body, re.I)
    return JobPostingDetail(
        url=url,
        source="linkedin",
        company=html_to_text(comp_m.group(1)) if comp_m else "",
        title=html_to_text(title_m.group(1)) if title_m else "",
        location=html_to_text(loc_m.group(1)) if loc_m else "",
        description=html_to_text(desc_m.group(1)) if desc_m else html_to_text(resp.body),
    )


def _fetch_gupy(url: str, org: str) -> JobPostingDetail:
    resp = fetch_with_retry(url, retries=1, timeout=10.0)
    if not resp.ok:
        raise RuntimeError(f"Falha ao buscar Gupy ({org}): {resp.error}")
    idx = resp.body.find('id="__NEXT_DATA__"')
    if idx != -1:
        start = resp.body.find(">", idx) + 1
        end = resp.body.find("</script>", start)
        if start > 0 and end > start:
            try:
                data = json.loads(resp.body[start:end])
                job = data.get("props", {}).get("pageProps", {}).get("job") or {}
                if isinstance(job, dict) and job:
                    parts = [
                        job.get("description", ""),
                        job.get("responsibilities", ""),
                        job.get("prerequisites", ""),
                    ]
                    desc = "\n\n".join(html_to_text(p) for p in parts if p)
                    loc = "/".join(p for p in (job.get("city"), job.get("state")) if p)
                    return JobPostingDetail(
                        url=url,
                        source="gupy",
                        company=job.get("careerPageName") or org,
                        title=job.get("name", ""),
                        location=loc,
                        workplace=job.get("workplaceType", ""),
                        description=desc,
                    )
            except Exception:
                pass
    return _parse_generic_html(url, resp.body)


def _parse_generic_html(url: str, body: str) -> JobPostingDetail:
    # Tenta JSON-LD JobPosting primeiro (Nível 1 de extração)
    ld_postings = extract_json_ld_job_postings(body)
    if ld_postings:
        jp = ld_postings[0]
        hiring = jp.get("hiringOrganization") or {}
        company = hiring.get("name", "") if isinstance(hiring, dict) else str(hiring)
        loc_node = jp.get("jobLocation")
        location = ""
        if isinstance(loc_node, dict):
            addr = loc_node.get("address") or {}
            if isinstance(addr, dict):
                location = ", ".join(p for p in (addr.get("addressLocality"), addr.get("addressRegion")) if p)
        return JobPostingDetail(
            url=url,
            source="json_ld",
            company=company,
            title=str(jp.get("title") or ""),
            location=location,
            workplace=str(jp.get("jobLocationType") or ""),
            employment=str(jp.get("employmentType") or ""),
            description=html_to_text(html_lib.unescape(str(jp.get("description") or ""))),
        )

    parser = _TextExtractor()
    parser.feed(body)
    text = html_to_text(body)
    return JobPostingDetail(url=url, source="web", title=parser.title.strip(), description=text)


def fetch_job_description(url: str) -> JobPostingDetail:
    """Busca e extrai a descrição completa da vaga a partir da URL (Ashby, Lever, Greenhouse, Gupy, LinkedIn ou HTML/JSON-LD)."""
    source, org, job_id = identify_job_source(url)
    if source == "ashby":
        return _fetch_ashby(url, org, job_id)
    if source == "lever":
        return _fetch_lever(url, org, job_id)
    if source == "greenhouse":
        return _fetch_greenhouse(url, org, job_id)
    if source == "linkedin":
        return _fetch_linkedin(url, job_id)
    if source == "gupy":
        return _fetch_gupy(url, org)

    resp = fetch_with_retry(url, retries=1, timeout=10.0)
    if not resp.ok:
        raise RuntimeError(f"Falha ao acessar {url}: {resp.error}")
    return _parse_generic_html(url, resp.body)
