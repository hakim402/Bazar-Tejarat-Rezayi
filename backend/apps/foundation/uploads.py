"""Preserve single-file domain limits while permitting bounded multi-file owner branding forms."""
from django.core.exceptions import RequestDataTooBig, TooManyFilesSent
from django.core.files.uploadhandler import FileUploadHandler


class FileCountGuard(FileUploadHandler):
    def __init__(self, request, maximum):
        super().__init__(request)
        self.maximum, self.count = maximum, 0

    def handle_raw_input(self, input_data, META, content_length, boundary, encoding=None):
        # CSRF and DRF can parse the same multipart body separately. Count each
        # parser pass, retaining the domain limit within every pass.
        self.count = 0

    def new_file(self, *args, **kwargs):
        self.count += 1
        if self.count > self.maximum:
            raise TooManyFilesSent("Too many uploaded files.")

    def receive_data_chunk(self, raw_data, start):
        return raw_data

    def file_complete(self, file_size):
        return None


class UploadBoundaryMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        site = request.path.startswith(("/admin/site/", "/admin/settings/", "/admin/site-setting/"))
        if site and request.method == "POST":
            try:
                if not 0 < int(request.META.get("CONTENT_LENGTH") or 0) <= 128 * 1024 * 1024:
                    raise ValueError
            except ValueError:
                raise RequestDataTooBig("Site form exceeds the 128 MiB aggregate request limit.") from None
        request.upload_handlers.insert(0, FileCountGuard(request, 32 if site else 1))
        return self.get_response(request)
