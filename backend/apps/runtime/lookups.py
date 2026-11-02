"""Preserve explicit i-lookups while keeping ordinary equality binary/no-pad."""
from django.db.models import CharField, TextField
from django.db.models.lookups import IContains, IEndsWith, IExact, IStartsWith


class Insensitive:
    def process_lhs(self, compiler, connection, *args, **kwargs):
        sql, params = super().process_lhs(compiler, connection, *args, **kwargs)
        return (f"UPPER({sql})" if connection.vendor == "mysql" else sql), params

    def process_rhs(self, compiler, connection, *args, **kwargs):
        sql, params = super().process_rhs(compiler, connection, *args, **kwargs)
        return (f"UPPER({sql})" if connection.vendor == "mysql" else sql), params


class PortableIExact(Insensitive, IExact):
    pass


class PortableIContains(Insensitive, IContains):
    pass


class PortableIStartsWith(Insensitive, IStartsWith):
    pass


class PortableIEndsWith(Insensitive, IEndsWith):
    pass


def register():
    for field in (CharField, TextField):
        for lookup in (PortableIExact, PortableIContains, PortableIStartsWith, PortableIEndsWith):
            field.register_lookup(lookup)
