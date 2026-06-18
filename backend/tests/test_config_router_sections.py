from app.gateway.routers.config import ALLOWED_SECTIONS


def test_config_router_allows_coding_agent_section():
    assert "coding_agent" in ALLOWED_SECTIONS
