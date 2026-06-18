from starlette.datastructures import Headers, URL

from app.gateway.csrf_middleware import is_allowed_auth_origin


class _Request:
    def __init__(self, headers: dict[str, str]) -> None:
        self.headers = Headers(headers)
        self.url = URL("http://127.0.0.1:19987/api/v1/auth/login/local")


def test_desktop_app_origin_is_allowed_when_configured(monkeypatch):
    monkeypatch.setenv("GATEWAY_CORS_ORIGINS", "app://-")

    request = _Request(
        {
            "origin": "app://-",
            "host": "127.0.0.1:19987",
        },
    )

    assert is_allowed_auth_origin(request) is True


def test_tauri_origin_is_not_allowed_for_electron_desktop(monkeypatch):
    monkeypatch.setenv("GATEWAY_CORS_ORIGINS", "app://-")

    request = _Request(
        {
            "origin": "tauri://localhost",
            "host": "127.0.0.1:19987",
        },
    )

    assert is_allowed_auth_origin(request) is False
