from django.apps import AppConfig


class RuntimeConfig(AppConfig):
    name = "apps.runtime"
    default_auto_field = "django.db.models.BigAutoField"

    def ready(self):
        from .lookups import register
        register()
