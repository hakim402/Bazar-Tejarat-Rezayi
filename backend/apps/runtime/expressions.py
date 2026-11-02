"""Target-native JSON and exact Python NFKC materialization for public search."""
import hashlib
import unicodedata
from django.db import connection
from django.db.models import CharField, Func, JSONField


class JsonPathText(Func):
    function = "jsonb_extract_path_text"
    output_field = CharField()

    def as_mysql(self, compiler, connection, **extra):
        parts = [compiler.compile(e) for e in self.source_expressions]
        source, source_params = parts[0]
        path = ["'$'"]
        parameters = list(source_params)
        for sql, params in parts[1:]:
            path.extend(["'.\"'", sql, "'\"'"])
            parameters.extend(params)
        return f"JSON_UNQUOTE(JSON_EXTRACT({source}, CONCAT({', '.join(path)})))", parameters


class VariantReference(Func):
    output_field = JSONField()

    def as_postgresql(self, compiler, connection, **extra):
        sql, params = compiler.compile(self.source_expressions[0])
        return f"jsonb_build_array(jsonb_build_object('id',CAST({sql} AS text),'active',true))", params

    def as_mysql(self, compiler, connection, **extra):
        sql, params = compiler.compile(self.source_expressions[0])
        return f"JSON_ARRAY(JSON_OBJECT('id',CONCAT(SUBSTRING({sql},1,8),'-',SUBSTRING({sql},9,4),'-',SUBSTRING({sql},13,4),'-',SUBSTRING({sql},17,4),'-',SUBSTRING({sql},21,12)),'active',JSON_EXTRACT('true','$')))", params * 5


class Normalized(Func):
    output_field = CharField()

    def as_postgresql(self, compiler, connection, **extra):
        sql, params = compiler.compile(self.source_expressions[0])
        return f"regexp_replace(normalize({sql}, NFKC), %s, %s, 'g')", [*params, r"\s+", " "]

    def as_mysql(self, compiler, connection, **extra):
        sql, params = compiler.compile(self.source_expressions[0])
        return f"(SELECT search_value.normalized FROM runtime_searchtext search_value WHERE search_value.digest=SHA2({sql},256))", params


def prepare_search(rows):
    """Materialize exact NFKC, not a lossy collation approximation.

    Only already-scoped public text is read, in bounded iterator batches. This
    trades additional DB I/O for exact Unicode behavior without a server UDF.
    Immutable digest entries can be shared safely by independent CGI processes.
    """
    if connection.vendor != "mysql":
        return
    from .models import SearchText
    def strings(value):
        if isinstance(value, str):
            yield value
        elif isinstance(value, dict):
            for item in value.values():
                yield from strings(item)
        elif isinstance(value, (list, tuple)):
            for item in value:
                yield from strings(item)
    pending = {}
    def flush():
        if not pending:
            return
        known = set(SearchText.objects.filter(pk__in=pending).values_list("pk", flat=True))
        SearchText.objects.bulk_create([SearchText(digest=digest, normalized=value)
            for digest, value in pending.items() if digest not in known], ignore_conflicts=True, batch_size=200)
        pending.clear()
    for row in rows.iterator(chunk_size=200):
        for value in strings(row):
            digest = hashlib.sha256(value.encode()).hexdigest()
            pending[digest] = " ".join(unicodedata.normalize("NFKC", value).split())
        if len(pending) >= 200:
            flush()
    flush()
