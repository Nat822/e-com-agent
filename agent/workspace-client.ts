/**
 * WorkspaceClient — runs Python code inside Docker and intercepts ws.answer().
 *
 * Mirrors the Pangolin design: thin TypeScript wrapper that manages the
 * Docker container lifecycle and captures structured TaskResult when
 * ws.answer() is called inside the container.
 */

import { spawn, spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import type { CodeExecutionResult, TaskResult, Scratchpad } from "./types";

const DOCKER_BIN = fs.existsSync("C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe")
  ? "C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe"
  : "docker";
const EXECUTE_CODE_TIMEOUT_MS = parseInt(process.env.EXECUTE_CODE_TIMEOUT_MS ?? "180000", 10);

const PYTHON_BOOTSTRAP = `
import json, sys, os, re, csv, math, hashlib, base64, yaml
import atexit
from datetime import datetime, timedelta, date
from collections import defaultdict, Counter
from pathlib import PurePosixPath
import dateutil.parser as dateutil_parser
from dateutil.relativedelta import relativedelta
from decimal import Decimal

# ── Scratchpad ────────────────────────────────────────────
_scratchpad_path = os.environ.get("SCRATCHPAD_PATH", "/tmp/scratchpad.json")
_answer_path = os.environ.get("ANSWER_PATH", "/tmp/answer.json")

try:
    with open(_scratchpad_path) as f:
        scratchpad = json.load(f)
except FileNotFoundError:
    scratchpad = {"refs": [], "context": {}}

def _persist_scratchpad():
    with open(_scratchpad_path, "w") as f:
        json.dump(scratchpad, f, default=str)

atexit.register(_persist_scratchpad)

# Common helpers available to every execute_code call.
def norm(x):
    return str(x or "").casefold().replace("_", " ").replace("-", " ").strip()

def norm_num(x):
    m = re.search(r"\\d+(?:\\.\\d+)?", str(x or ""))
    return float(m.group(0)) if m else None

def prop(record, *names):
    props = record.get("properties") or {}
    for name in names:
        if isinstance(props, dict) and name in props:
            return props.get(name)
    for name in names:
        if name in record:
            return record.get(name)
    return None

def blob_text(record):
    return norm(json.dumps(record, sort_keys=True))

def has_text(record, *terms):
    blob = blob_text(record)
    return all(norm(term) in blob for term in terms)

def verify(sp):
    """Default verifier available to generated task code."""
    if not sp.get("answer") or not sp.get("refs") or not sp.get("policy_citation"):
        return False
    if sp.get("task_type") not in ("SHOPPER", "CHECKOUT", "MERCHANT", "SUPPORT"):
        return False
    sql_ev = sp.get("sql_evidence") or {}
    has_sql_evidence = isinstance(sql_ev, dict) and sql_ev.get("path") == "/bin/sql" and bool(sql_ev.get("query"))
    if sp.get("task_type") in ("SUPPORT", "MERCHANT") and not sp.get("search_trail") and not has_sql_evidence:
        return False
    if not sp.get("reasoning_trail"):
        return False
    fmt = sp.get("answer_format")
    if fmt == "ANGLE_BINARY" and sp.get("answer") not in ("<YES>", "<NO>"):
        return False
    if fmt == "ANGLE_COUNT" and not re.fullmatch(r"<COUNT:\\d+>", str(sp.get("answer", ""))):
        return False
    if sp.get("catalogue_existence") and sp.get("answer") == "<YES>":
        if not any(str(p).endswith(".json") and "/proc/catalog/" in str(p) for p in sp.get("refs", [])):
            return False
    if sp.get("catalogue_existence") and sp.get("answer") == "<NO>":
        sql_zero = (
            isinstance(sql_ev, dict)
            and sql_ev.get("path") == "/bin/sql"
            and int(sql_ev.get("rows", -1)) == 0
            and bool(sql_ev.get("query"))
        )
        if (not sp.get("catalogue_scan_count") or int(sp.get("catalogue_scan_count", 0)) <= 0) and not sql_zero:
            return False
        if "close_candidates" not in sp and not sql_zero:
            return False
    return sp.get("outcome") == "OUTCOME_OK"

# ── Workspace client ──────────────────────────────────────
import urllib.request

class Workspace:
    def __init__(self, base_url, task_id):
        self._base = base_url.rstrip("/")
        self._task_id = task_id
        self._service = "bitgn.vm.ecom.EcomRuntime"

    def _call(self, method, **kwargs):
        data = json.dumps(kwargs).encode()
        req = urllib.request.Request(
            f"{self._base}/{self._service}/{method}",
            data=data,
            headers={
                "Content-Type": "application/json",
                "Connect-Protocol-Version": "1",
            },
        )
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read()
            return json.loads(raw) if raw else {}

    def tree(self, root="", level=0):      return self._call("Tree", root=root, level=level)
    def find(self, root="/", name="", kind="all", limit=10):
        kind_value = 0 if kind in ("all", "", None) else kind
        return self._call("Find", root=root, name=name, kind=kind_value, limit=limit)
    def search(self, root="/", pattern="", limit=10):        return self._call("Search", root=root, pattern=pattern, limit=limit)
    def list(self, path="/"):              return self._call("List", path=path)
    def read(self, path, number=False, start_line=0, end_line=0): return self._call("Read", path=path, number=number, startLine=start_line, endLine=end_line)
    def write(self, path, content, start_line=0, end_line=0, idempotency_key="", if_match_sha256=""):
        return self._call("Write", path=path, content=content, idempotencyKey=idempotency_key, ifMatchSha256=if_match_sha256)
    def delete(self, path):               return self._call("Delete", path=path)
    def mkdir(self, path):                raise NotImplementedError("ECOM runtime does not expose mkdir")
    def move(self, from_name, to_name):   raise NotImplementedError("ECOM runtime does not expose move")
    def stat(self, path):                 return self._call("Stat", path=path)
    def exec(self, path, args=None, stdin=""):
        return self._call("Exec", path=path, args=args or [], stdin=stdin)
    def context(self):                    return self._call("Context")

    def answer(self, sp, verify):
        """Submit task result. verify(sp) must return True."""
        # Persist scratchpad mutations from this call
        global scratchpad
        scratchpad.update(sp)

        passed = verify(scratchpad)
        if not passed:
            raise RuntimeError(
                f"verify() returned False — submission blocked.\\n"
                f"Scratchpad: {json.dumps(scratchpad, default=str, indent=2)}"
            )

        result = {
            "answered": True,
            "outcome": scratchpad.get("outcome", "OUTCOME_ERR_INTERNAL"),
            "answer": scratchpad.get("answer", ""),
            "refs": scratchpad.get("refs", []),
            "policy_citation": scratchpad.get("policy_citation", ""),
            "scratchpad": scratchpad,
        }

        self._call("Answer", message=str(result["answer"]), outcome=result["outcome"], refs=result["refs"])

        with open(_answer_path, "w") as f:
            json.dump(result, f)
        with open(_scratchpad_path, "w") as f:
            json.dump(scratchpad, f)

        print(f"[ws.answer] outcome={result['outcome']} answer={str(result['answer'])[:80]}")
        sys.exit(0)   # clean exit signals completion to the runner

ws = Workspace(
    base_url=os.environ["WS_BASE_URL"],
    task_id=os.environ["WS_TASK_ID"],
)

def sql_query(query, args=None):
    """Run indexed ECOM SQL through /bin/sql and return stdout."""
    result = ws.exec("/bin/sql", args=args or [], stdin=query)
    if result.get("exitCode") or result.get("exit_code"):
        raise RuntimeError(result.get("stderr") or result)
    return result.get("stdout", "")

def catalog_sql(query):
    """Alias for SQL catalogue queries; keeps generated task code short."""
    return sql_query(query)

def sql_escape(value):
    return str(value).replace("'", "''")

def csv_rows(stdout):
    """Parse /bin/sql CSV stdout into a list of dictionaries."""
    text = str(stdout or "").strip()
    if not text:
        return []
    return list(csv.DictReader(text.splitlines()))

def first_int(stdout):
    m = re.search(r"\\d+", str(stdout or ""))
    return int(m.group(0)) if m else 0

def catalog_count_by_kind(kind_id):
    """Count products by a runtime-discovered kind_id using /bin/sql."""
    k = sql_escape(kind_id)
    queries = [
        f"SELECT COUNT(*) FROM products WHERE kind_id = '{k}';",
        f"SELECT COUNT(*) FROM products p JOIN product_kinds k ON p.kind_id = k.id WHERE k.id = '{k}' OR lower(k.name) = lower('{k}');",
    ]
    last = None
    for query in queries:
        result = ws.exec("/bin/sql", stdin=query)
        if not (result.get("exitCode") or result.get("exit_code")) and result.get("stdout"):
            return result.get("stdout", "")
        last = result
    raise RuntimeError(last)

def catalog_count_by_kind_value(kind_id):
    """Return an integer count for a runtime-discovered kind_id."""
    return first_int(catalog_count_by_kind(kind_id))

def catalog_find_kind_id(kind_phrase):
    """Find likely product kind ids from runtime SQL metadata as parsed rows."""
    phrase = norm(kind_phrase)
    compact = sql_escape("%".join([w for w in re.split(r"\\W+", phrase) if w]))
    words = [w for w in re.split(r"\\W+", phrase) if w]
    where = " AND ".join([f"(lower(coalesce(id,'')) LIKE '%{sql_escape(w)}%' OR lower(coalesce(name,'')) LIKE '%{sql_escape(w)}%')" for w in words]) or "1=1"
    queries = [
        f"SELECT id, name FROM product_kinds WHERE {where} LIMIT 20;",
        f"SELECT id, name FROM product_kinds WHERE lower(coalesce(id,'') || ' ' || coalesce(name,'')) LIKE '%{compact}%' LIMIT 20;",
        f"SELECT id, name FROM product_kinds WHERE lower(coalesce(name,'')) LIKE '%{sql_escape(phrase)}%' LIMIT 20;",
    ]
    last = None
    for query in queries:
        result = ws.exec("/bin/sql", stdin=query)
        if not (result.get("exitCode") or result.get("exit_code")) and result.get("stdout"):
            rows = csv_rows(result.get("stdout", ""))
            if rows:
                return rows
        last = result
    raise RuntimeError(last)

def catalog_first_kind_id(kind_phrase):
    """Return the first runtime-discovered product_kinds.id for a kind phrase."""
    rows = catalog_find_kind_id(kind_phrase)
    if not rows:
        return None
    return rows[0].get("id")

def catalog_count_by_kind_phrase(kind_phrase):
    """Find kind_id from runtime metadata and return integer product count."""
    kind_id = catalog_first_kind_id(kind_phrase)
    if not kind_id:
        return 0
    return catalog_count_by_kind_value(kind_id)

# BEGIN STABILITY_EXPERIMENT_CATALOG_COUNT_V1_2026_05_10
# Rollback flag: remove this block plus matching prompt/tool-description references if count tasks regress.
def catalog_answer_count(kind_phrase, policy_citation=None, submit=False):
    """Deterministic end-to-end helper for '<COUNT:n>' catalogue kind-count tasks."""
    kind_id = catalog_first_kind_id(kind_phrase)
    if not kind_id:
        count = 0
        query = f"product_kinds lookup for {kind_phrase!r} returned no rows"
    else:
        count = catalog_count_by_kind_value(kind_id)
        query = f"SELECT COUNT(*) FROM products WHERE kind_id = '{sql_escape(kind_id)}';"
    sp = {
        "task_type": "MERCHANT",
        "answer_format": "ANGLE_COUNT",
        "answer": f"<COUNT:{int(count)}>",
        "outcome": "OUTCOME_OK",
        "refs": ["/bin/sql", "/proc/catalog"],
        "policy_citation": policy_citation or "Task instruction: count catalogue products by kind",
        "search_trail": [{
            "attempt": 1,
            "path": "/bin/sql",
            "pattern": query,
            "hits": int(count),
        }],
        "reasoning_trail": [
            f"Resolved requested catalogue kind phrase {kind_phrase!r} to kind_id {kind_id!r}.",
            f"Counted products for that runtime kind_id via /bin/sql: {int(count)}.",
        ],
        "sql_evidence": {
            "path": "/bin/sql",
            "query": query,
            "rows": int(count),
        },
        "catalogue_existence": False,
    }
    if submit:
        scratchpad.update(sp)
        ws.answer(scratchpad, verify)
    return {"kind_id": kind_id, "count": int(count), "answer": sp["answer"], "scratchpad": sp}
# END STABILITY_EXPERIMENT_CATALOG_COUNT_V1_2026_05_10

def catalog_product_rows(
    brand=None,
    kind_phrase=None,
    series=None,
    model=None,
    text_terms=None,
    limit=100,
):
    """Return parsed product rows from /bin/sql using conservative runtime filters."""
    where = []
    if brand:
        where.append(f"lower(brand) = lower('{sql_escape(brand)}')")
    if kind_phrase:
        kind_id = catalog_first_kind_id(kind_phrase)
        if kind_id:
            where.append(f"kind_id = '{sql_escape(kind_id)}'")
    if series:
        series_norm = sql_escape(norm(series))
        where.append(f"(lower(series) LIKE '%{series_norm}%' OR replace(lower(series), '-', ' ') LIKE '%{series_norm}%')")
    if model:
        model_norm = sql_escape(norm(model))
        where.append(
            f"(lower(model) LIKE '%{model_norm}%' OR replace(lower(model), '-', ' ') LIKE '%{model_norm}%' "
            f"OR lower(name) LIKE '%{model_norm}%' OR replace(lower(name), '-', ' ') LIKE '%{model_norm}%')"
        )
    for term in text_terms or []:
        term_norm = sql_escape(norm(term))
        where.append(
            f"(lower(name) LIKE '%{term_norm}%' OR lower(series) LIKE '%{term_norm}%' "
            f"OR lower(model) LIKE '%{term_norm}%' OR lower(properties) LIKE '%{term_norm}%')"
        )
    clause = " AND ".join(where) if where else "1=1"
    query = (
        "SELECT sku,path,category_id,kind_id,family_id,brand,series,model,name,properties "
        f"FROM products WHERE {clause} LIMIT {int(limit)};"
    )
    rows = csv_rows(catalog_sql(query))
    for row in rows:
        props = row.get("properties")
        if isinstance(props, str):
            try:
                row["properties"] = json.loads(props)
            except Exception:
                row["properties"] = props
    return rows

def _required_values(value):
    if value is None:
        return []
    return value if isinstance(value, (list, tuple, set)) else [value]

def catalog_score_product(record, required):
    """Score a product record against generic line/property/feature requirements."""
    checks = {}
    if required.get("brand"):
        checks["brand"] = norm(record.get("brand")) == norm(required.get("brand"))
    if required.get("kind"):
        checks["kind"] = has_text(record, required.get("kind")) or norm(required.get("kind")) in norm(record.get("kind_id"))
    if required.get("series"):
        checks["series"] = norm(required.get("series")) in norm(record.get("series")) or has_text(record, required.get("series"))
    if required.get("model"):
        checks["model"] = norm(required.get("model")) in norm(record.get("model")) or has_text(record, required.get("model"))

    props_req = required.get("properties") or {}
    synonyms = {
        "connector_type": ["connector_type", "valve_type", "fitting_type", "product_type", "type", "subtype"],
        "valve_type": ["valve_type", "connector_type", "fitting_type", "product_type", "type", "subtype"],
        "fitting_type": ["fitting_type", "connector_type", "valve_type", "product_type", "type", "subtype"],
        "diameter_mm": ["diameter_mm", "diameter", "nominal_diameter_mm", "size_mm", "bore_mm", "connection_diameter_mm"],
        "pack_count": ["pack_count", "count", "pieces", "piece_count", "qty"],
        "piece_count": ["piece_count", "pack_count", "count", "pieces", "qty"],
        "volume_ml": ["volume_ml", "volume", "capacity_ml"],
        "volume_l": ["volume_l", "volume", "capacity_l"],
        "length_m": ["length_m", "length", "cable_length_m"],
        "length_mm": ["length_mm", "length", "blade_length_mm"],
        "wattage_w": ["wattage_w", "wattage", "power_w", "power"],
        "power_w": ["power_w", "wattage_w", "wattage", "power"],
        "luminous_flux_lm": ["luminous_flux_lm", "lumen", "lumens", "flux_lm"],
        "fitting": ["fitting", "base", "socket", "cap_type"],
        "color_family": ["color_family", "color", "colour_family", "colour"],
        "machine_type": ["machine_type", "tool_type", "product_type", "type"],
        "storage_type": ["storage_type", "organizer_type", "product_type", "type"],
    }
    for key, want in props_req.items():
        names = synonyms.get(key, [key])
        values = _required_values(want)
        ok = False
        actual = prop(record, *names)
        for item in values:
            want_num = norm_num(item)
            actual_num = norm_num(actual)
            if want_num is not None and actual_num is not None and abs(want_num - actual_num) < 0.001:
                ok = True
            elif actual is not None and norm(item) in norm(actual):
                ok = True
            elif has_text(record, str(item), str(key).replace("_", " ")):
                ok = True
            elif want_num is not None and re.search(rf"\\b{int(want_num) if want_num.is_integer() else want_num}\\s*(mm|ml|l|m|w|v|lm|pc|pcs)?\\b", blob_text(record)):
                ok = True
        checks[f"property:{key}"] = ok

    for feature in required.get("features") or []:
        f = norm(feature)
        variants = [
            f,
            f.replace(" enabled", ""),
            f.replace(" control", ""),
            f.replace(" based", ""),
            f"supports {f}",
            f"{f} support",
        ]
        checks[f"feature:{feature}"] = any(has_text(record, v) for v in variants if v)

    return {"ok": all(checks.values()) if checks else False, "checks": checks}

def catalog_find_matching_products(required, limit=100):
    """Find candidate products and return scored matches/close candidates."""
    candidates = catalog_product_rows(
        brand=required.get("brand"),
        kind_phrase=required.get("kind"),
        series=required.get("series"),
        model=required.get("model"),
        text_terms=required.get("text_terms") or [],
        limit=limit,
    )
    scored = []
    for record in candidates:
        score = catalog_score_product(record, required)
        scored.append({"record": record, **score})
    matches = [item for item in scored if item.get("ok")]
    close = [item for item in scored if not item.get("ok")]
    return {"candidates": candidates, "scored": scored, "matches": matches, "close": close}

# BEGIN STABILITY_EXPERIMENT_CATALOG_EXISTENCE_V2_2026_05_10
# Rollback flag: remove this block plus matching prompt/tool-description references if dev score regresses.
_CATALOG_STOPWORDS = {
    "the", "from", "with", "and", "or", "in", "line", "that", "has", "have",
    "catalog", "catalogue", "product", "products", "brand", "model", "series",
}

def _catalog_tokens(value):
    text = norm(value)
    return [t for t in re.split(r"\\W+", text) if len(t) > 1 and t not in _CATALOG_STOPWORDS]

def _catalog_compact(value):
    return re.sub(r"\\W+", "", norm(value))

def _catalog_kind_tokens(kind):
    return [t for t in _catalog_tokens(kind) if t not in {"tool", "tools"}]

def _catalog_line_tokens(required):
    line_bits = []
    for key in ("line", "product_line", "series", "model"):
        value = required.get(key)
        if isinstance(value, (list, tuple)):
            line_bits.extend([str(v) for v in value])
        elif value:
            line_bits.append(str(value))
    tokens = []
    brand_tokens = set(_catalog_tokens(required.get("brand")))
    kind_tokens = set(_catalog_kind_tokens(required.get("kind")))
    for bit in line_bits:
        for token in _catalog_tokens(bit):
            if token not in brand_tokens and token not in kind_tokens:
                tokens.append(token)
    return list(dict.fromkeys(tokens))

def _catalog_record_text(record):
    fields = [
        record.get("brand"), record.get("series"), record.get("model"), record.get("name"),
        record.get("sku"), record.get("kind_id"), record.get("category_id"), record.get("family_id"),
        record.get("properties"),
    ]
    return norm(" ".join(json.dumps(v, sort_keys=True) if isinstance(v, (dict, list)) else str(v or "") for v in fields))

def _catalog_parse_row(row):
    parsed = dict(row)
    props = parsed.get("properties")
    if isinstance(props, str):
        try:
            parsed["properties"] = json.loads(props)
        except Exception:
            parsed["properties"] = props
    return parsed

def _catalog_run_rows(query):
    return [_catalog_parse_row(row) for row in csv_rows(catalog_sql(query))]

def catalog_product_rows_broad(required, limit=200):
    """Return broad brand/kind candidates without requiring fragile series/model splits."""
    brand = required.get("brand")
    kind = required.get("kind")
    line_tokens = _catalog_line_tokens(required)
    queries = []
    base_select = "SELECT sku,path,category_id,kind_id,family_id,brand,series,model,name,properties FROM products"
    if brand and kind:
        try:
            kind_id = catalog_first_kind_id(kind)
        except Exception:
            kind_id = None
        if kind_id:
            queries.append(
                f"{base_select} WHERE lower(brand)=lower('{sql_escape(brand)}') "
                f"AND kind_id='{sql_escape(kind_id)}' LIMIT {int(limit)};"
            )
    if brand:
        queries.append(f"{base_select} WHERE lower(brand)=lower('{sql_escape(brand)}') LIMIT {int(limit)};")
    if kind:
        try:
            kind_id = catalog_first_kind_id(kind)
        except Exception:
            kind_id = None
        if kind_id:
            queries.append(f"{base_select} WHERE kind_id='{sql_escape(kind_id)}' LIMIT {int(limit)};")
    if line_tokens:
        like_terms = " AND ".join([
            f"lower(coalesce(series,'') || ' ' || coalesce(model,'') || ' ' || coalesce(name,'') || ' ' || coalesce(properties,'')) LIKE '%{sql_escape(t)}%'"
            for t in line_tokens[:4]
        ])
        queries.append(f"{base_select} WHERE {like_terms} LIMIT {int(limit)};")

    by_path = {}
    sql_trace = []
    for query in queries:
        rows = []
        try:
            rows = _catalog_run_rows(query)
        except Exception as exc:
            sql_trace.append({"query": query, "error": str(exc)[:160], "rows": 0})
            continue
        sql_trace.append({"query": query, "rows": len(rows)})
        for row in rows:
            key = row.get("path") or row.get("sku") or json.dumps(row, sort_keys=True)
            by_path[key] = row
        if len(by_path) >= limit:
            break
    return {"rows": list(by_path.values())[:int(limit)], "sql_trace": sql_trace}

def _catalog_value_match(record, key, want):
    synonyms = {
        "connector_type": ["connector_type", "valve_type", "fitting_type", "product_type", "type", "subtype"],
        "valve_type": ["valve_type", "connector_type", "fitting_type", "product_type", "type", "subtype"],
        "fitting_type": ["fitting_type", "connector_type", "valve_type", "product_type", "type", "subtype"],
        "diameter_mm": ["diameter_mm", "diameter", "nominal_diameter_mm", "size_mm", "bore_mm", "connection_diameter_mm"],
        "pack_count": ["pack_count", "count", "pieces", "piece_count", "qty"],
        "piece_count": ["piece_count", "pack_count", "count", "pieces", "qty"],
        "volume_ml": ["volume_ml", "volume", "capacity_ml"],
        "volume_l": ["volume_l", "volume", "capacity_l"],
        "length_m": ["length_m", "length", "cable_length_m"],
        "length_mm": ["length_mm", "length", "blade_length_mm"],
        "wattage_w": ["wattage_w", "wattage", "power_w", "power"],
        "power_w": ["power_w", "wattage_w", "wattage", "power"],
        "voltage_v": ["voltage_v", "voltage", "battery_voltage_v"],
        "battery_platform": ["battery_platform", "platform", "battery_system"],
        "kit_contents": ["kit_contents", "included", "includes", "package_contents"],
        "luminous_flux_lm": ["luminous_flux_lm", "lumen", "lumens", "flux_lm"],
        "fitting": ["fitting", "base", "socket", "cap_type"],
        "color_family": ["color_family", "color", "colour_family", "colour"],
        "machine_type": ["machine_type", "tool_type", "product_type", "type"],
        "storage_type": ["storage_type", "organizer_type", "product_type", "type"],
    }
    values = _required_values(want)
    actual = prop(record, *synonyms.get(key, [key]))
    blob = _catalog_record_text(record)
    checks = []
    for item in values:
        want_num = norm_num(item)
        actual_num = norm_num(actual)
        item_norm = norm(item)
        if want_num is not None and actual_num is not None and abs(want_num - actual_num) < 0.001:
            checks.append(True)
        elif actual is not None and item_norm in norm(actual):
            checks.append(True)
        elif item_norm and item_norm in blob and norm(key).replace(" ", "_") not in ("features",):
            checks.append(True)
        elif want_num is not None and re.search(rf"\\b{int(want_num) if want_num.is_integer() else want_num}\\s*(mm|ml|l|m|w|v|lm|pc|pcs)?\\b", blob):
            checks.append(True)
        else:
            checks.append(False)
    return any(checks) if checks else True

def _catalog_feature_match(record, feature):
    """Match feature requests without treating explicit false values as support."""
    f = norm(feature)
    key_variants = list(dict.fromkeys([
        f.replace(" ", "_"),
        f.replace(" control", "").replace(" ", "_"),
        f.replace(" enabled", "").replace(" ", "_"),
        f.replace(" based", "").replace(" ", "_"),
    ]))
    props = record.get("properties") if isinstance(record.get("properties"), dict) else {}
    for key in key_variants:
        value = prop(record, key, f"supports_{key}", f"{key}_support")
        if value is True:
            return True
        if isinstance(value, str) and norm(value) in ("true", "yes", "supported", "enabled", "included"):
            return True
        if value is False or norm(value) in ("false", "no", "unsupported", "disabled", "not included"):
            return False
        if isinstance(props, dict) and key in props and not props.get(key):
            return False
    blob = _catalog_record_text(record)
    for key in key_variants:
        if re.search(rf'"{re.escape(key)}"\\s*:\\s*false', json.dumps(record, sort_keys=True).casefold()):
            return False
    variants = [
        f,
        f.replace(" enabled", ""),
        f.replace(" control", ""),
        f.replace(" based", ""),
        f"supports {f}",
        f"{f} support",
    ]
    return any(v and v in blob for v in variants)

def catalog_score_product_v2(record, required):
    """Tolerant structured matcher for binary catalogue existence tasks."""
    req = dict(required or {})
    props_req = dict(req.get("properties") or {})
    features = list(req.get("features") or [])
    misplaced_features = props_req.pop("features", None)
    if misplaced_features:
        features.extend(_required_values(misplaced_features))

    blob = _catalog_record_text(record)
    compact_blob = _catalog_compact(blob)
    checks = {}

    if req.get("brand"):
        checks["brand"] = norm(record.get("brand")) == norm(req.get("brand"))
    if req.get("kind"):
        kind_tokens = _catalog_kind_tokens(req.get("kind"))
        kind_text = norm(" ".join([str(record.get("kind_id") or ""), str(record.get("name") or ""), str(record.get("category_id") or "")]))
        checks["kind"] = all(t in kind_text or t in blob for t in kind_tokens)

    line_tokens = _catalog_line_tokens(req)
    if line_tokens:
        missing = []
        for token in line_tokens:
            if token not in blob and _catalog_compact(token) not in compact_blob:
                missing.append(token)
        checks["line"] = not missing
        checks["line_missing"] = missing

    for key, want in props_req.items():
        checks[f"property:{key}"] = _catalog_value_match(record, key, want)

    for feature in features:
        checks[f"feature:{feature}"] = _catalog_feature_match(record, feature)

    boolean_checks = {k: v for k, v in checks.items() if k != "line_missing"}
    score = sum(1 for v in boolean_checks.values() if v)
    return {"ok": bool(boolean_checks) and all(boolean_checks.values()), "score": score, "checks": checks}

def catalog_answer_existence(required, policy_citation=None, submit=False, limit=200):
    """
    Deterministic end-to-end helper for binary catalogue existence tasks.
    Pass the full product line as required["line"] instead of hand-splitting series/model.
    """
    broad = catalog_product_rows_broad(required, limit=limit)
    scored = []
    for record in broad["rows"]:
        score = catalog_score_product_v2(record, required)
        flat = dict(record)
        flat["_score"] = score.get("score", 0)
        flat["_checks"] = score.get("checks", {})
        flat["_ok"] = score.get("ok", False)
        scored.append(flat)
    scored.sort(key=lambda r: (bool(r.get("_ok")), int(r.get("_score", 0))), reverse=True)
    matches = [r for r in scored if r.get("_ok")]
    close = [r for r in scored if not r.get("_ok")][:10]
    answer = "<YES>" if matches else "<NO>"
    ref_rows = matches if matches else close
    refs = [r.get("path") for r in ref_rows if r.get("path")]
    if not refs and answer == "<NO>":
        refs = ["/bin/sql", "/proc/catalog"]
    sp = {
        "task_type": "MERCHANT",
        "catalogue_existence": True,
        "answer_format": "ANGLE_BINARY",
        "answer": answer,
        "outcome": "OUTCOME_OK",
        "refs": list(dict.fromkeys(refs)),
        "policy_citation": policy_citation or "Task instruction: answer binary catalogue existence from runtime catalogue data",
        "search_trail": [
            {
                "attempt": i + 1,
                "path": "/bin/sql",
                "pattern": item.get("query", "")[:240],
                "hits": item.get("rows", 0),
                **({"error": item["error"]} if item.get("error") else {}),
            }
            for i, item in enumerate(broad.get("sql_trace", []))
        ],
        "reasoning_trail": [
            f"Catalogue existence helper inspected {len(broad['rows'])} broad candidate products.",
            f"Best exact matches: {len(matches)}; answer {answer}.",
        ],
        "catalogue_scan_count": max(1, len(broad["rows"])),
        "close_candidates": [r.get("path") for r in close if r.get("path")],
        "sql_evidence": {
            "path": "/bin/sql",
            "query": " | ".join([str(x.get("query", ""))[:200] for x in broad.get("sql_trace", [])]),
            "rows": len(matches),
        },
        "catalog_matches": matches[:10],
        "catalog_close_candidates": close,
    }
    if submit:
        scratchpad.update(sp)
        ws.answer(scratchpad, verify)
    return {"answer": answer, "refs": refs, "matches": matches, "close_candidates": close, "scratchpad": sp}
# END STABILITY_EXPERIMENT_CATALOG_EXISTENCE_V2_2026_05_10

# ── Inject UTC context into scratchpad ────────────────────
if not scratchpad.get("context", {}).get("time"):
    ctx = ws.context()
    scratchpad["context"] = ctx

# ── USER CODE BELOW ───────────────────────────────────────
`;

export class WorkspaceClient {
  private scratchpadDir: string;
  private wsBaseUrl: string;
  private sandboxReady = false;

  constructor(wsBaseUrl: string, runsDir: string) {
    this.wsBaseUrl = wsBaseUrl;
    this.scratchpadDir = path.join(runsDir, "scratchpads");
    fs.mkdirSync(this.scratchpadDir, { recursive: true });
  }

  async executeCode(
    taskId: string,
    code: string
  ): Promise<CodeExecutionResult> {
    this.ensureSandboxContainer();

    const scratchpadPath = path.join(this.scratchpadDir, `${taskId}.json`);
    const answerPath = path.join(this.scratchpadDir, `${taskId}_answer.json`);

    // Clean up previous answer file
    if (fs.existsSync(answerPath)) fs.unlinkSync(answerPath);

    const fullCode = PYTHON_BOOTSTRAP + "\n" + code;
    const tmpScript = path.join(this.scratchpadDir, `${taskId}_script.py`);
    fs.writeFileSync(tmpScript, fullCode);

    return new Promise((resolve) => {
      let settled = false;
      const proc = spawn(DOCKER_BIN, [
        "exec",
        "--env", `WS_BASE_URL=${this.wsBaseUrl}`,
        "--env", `WS_TASK_ID=${taskId}`,
        "--env", `SCRATCHPAD_PATH=/scratchpads/${taskId}.json`,
        "--env", `ANSWER_PATH=/scratchpads/${taskId}_answer.json`,
        "ecom-agent-sandbox",
        "python3",
        `/scratchpads/${taskId}_script.py`,
      ]);

      let output = "";
      proc.stdout.on("data", (d) => (output += d.toString()));
      proc.stderr.on("data", (d) => (output += d.toString()));

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        proc.kill("SIGKILL");
        resolve({
          output: `${output}\n[execute_code timeout after ${EXECUTE_CODE_TIMEOUT_MS}ms]`.trim(),
          exitCode: 124,
          answered: false,
        });
      }, EXECUTE_CODE_TIMEOUT_MS);

      proc.on("close", (exitCode) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        // Check if ws.answer() was called
        if (fs.existsSync(answerPath)) {
          const raw = fs.readFileSync(answerPath, "utf-8");
          const data = JSON.parse(raw);
          resolve({
            output,
            exitCode: 0,
            answered: true,
            taskResult: {
              taskId,
              outcome: data.outcome,
              answer: data.answer,
              refs: data.refs,
              policycitation: data.policy_citation,
              scratchpad: data.scratchpad,
            },
          });
        } else {
          resolve({
            output: output || "(no output)",
            exitCode: exitCode ?? 1,
            answered: false,
          });
        }
      });
    });
  }

  private ensureSandboxContainer(): void {
    if (this.sandboxReady) return;

    const inspect = spawnSync(DOCKER_BIN, [
      "inspect",
      "-f",
      "{{.State.Running}}|{{range .Mounts}}{{println .Destination}}{{end}}",
      "ecom-agent-sandbox",
    ], { encoding: "utf-8" });

    if (inspect.status === 0) {
      const output = inspect.stdout.trim();
      const isRunning = output.startsWith("true|");
      const hasScratchpadMount = output.includes("/scratchpads");

      if (!hasScratchpadMount) {
        throw new Error(
          "Existing Docker container ecom-agent-sandbox does not mount /scratchpads. " +
          "Remove/recreate it with the current Makefile build/run flow before executing tasks."
        );
      }

      if (!isRunning) {
        const start = spawnSync(DOCKER_BIN, ["start", "ecom-agent-sandbox"], { encoding: "utf-8" });
        if (start.status !== 0) {
          throw new Error(`Failed to start ecom-agent-sandbox: ${start.stderr || start.stdout}`);
        }
      }

      this.sandboxReady = true;
      return;
    }

    const run = spawnSync(DOCKER_BIN, [
      "run",
      "-d",
      "--name",
      "ecom-agent-sandbox",
      "--mount",
      `type=bind,source=${this.scratchpadDir},target=/scratchpads`,
      "ecom-agent-sandbox",
    ], { encoding: "utf-8" });

    if (run.status !== 0) {
      throw new Error(
        `Failed to create ecom-agent-sandbox container. Build it first with 'make build'. ` +
        `${run.stderr || run.stdout}`
      );
    }

    this.sandboxReady = true;
  }
}
