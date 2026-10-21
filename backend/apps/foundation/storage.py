from dataclasses import dataclass
from pathlib import PurePosixPath

from django.core.exceptions import SuspiciousFileOperation
from django.core.files.storage import FileSystemStorage, storages


class PrivateFileStorage(FileSystemStorage):
    def __init__(self, *args, **kwargs):
        kwargs.setdefault("file_permissions_mode", 0o600)
        kwargs.setdefault("directory_permissions_mode", 0o700)
        super().__init__(*args, **kwargs)

    def url(self, name):
        raise SuspiciousFileOperation("Private files require an authorized download handler.")


@dataclass(frozen=True)
class FileLocation:
    storage_alias: str
    key: str

    def __post_init__(self):
        path = PurePosixPath(self.key)
        if (
            self.storage_alias not in {"public_local", "private_local", "catalogue_local", "catalogue_s3"}
            or not self.key
            or path.is_absolute()
            or ".." in path.parts
            or "\\" in self.key
        ):
            raise SuspiciousFileOperation("Invalid stored file location.")

    def open(self):
        # Future callers must authorize the resource before opening its recorded location.
        return storages[self.storage_alias].open(self.key, "rb")

    def public_url(self):
        if self.storage_alias != "public_local":
            raise SuspiciousFileOperation("Private files do not have public URLs.")
        return storages[self.storage_alias].url(self.key)
