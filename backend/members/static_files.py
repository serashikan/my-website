from django.http import HttpResponse
from whitenoise.middleware import WhiteNoiseMiddleware


class SiteStaticFilesMiddleware(WhiteNoiseMiddleware):
    """保留流式视频响应，并兼容 WhiteNoise 6.12 的单字节 Range 边界。"""

    @staticmethod
    def serve(static_file, request):
        range_header = request.META.get("HTTP_RANGE")
        if (range_header and request.method in {"GET", "HEAD"}
                and hasattr(static_file, "get_byte_range")
                and not static_file.is_not_modified(request.META)):
            path, headers = static_file.get_path_and_headers(request.META)
            headers = dict(headers)
            size = int(headers["Content-Length"])
            try:
                start, end = static_file.get_byte_range(range_header, size)
            except ValueError:
                pass
            else:
                if 0 <= start == end < size:
                    content = b""
                    if request.method == "GET":
                        with open(path, "rb") as stream:
                            stream.seek(start)
                            content = stream.read(1)
                    response = HttpResponse(content, status=206, headers=headers)
                    response["Content-Range"] = f"bytes {start}-{end}/{size}"
                    response["Content-Length"] = "1"
                    return response
        return WhiteNoiseMiddleware.serve(static_file, request)
