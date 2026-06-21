from __future__ import annotations

import json


def test_qiongqi_roi_telemetry_records_report_usage_and_counters(tmp_path, monkeypatch):
    from kkoclaw.coding_core.qiongqi import QiongqiEngine
    from kkoclaw.coding_core.roi_telemetry import QiongqiRoiTelemetryStore

    home = tmp_path / "home"
    project = tmp_path / "project"
    project.mkdir()
    monkeypatch.setenv("HOME", str(home))

    engine = QiongqiEngine.from_runtime(project_root=str(project), thread_id="thread-roi")
    report = engine.build_roi_report(
        stable_prompt="stable",
        tools=[{"name": "read_file_lines"}, {"name": "bash"}],
        visible_tools=[{"name": "read_file_lines"}],
    )

    store = QiongqiRoiTelemetryStore.from_home()
    record = store.record_report(
        "thread-roi",
        report=report,
        provider_usage={"input_tokens": 100, "output_tokens": 25, "total_tokens": 125},
        tool_output={"externalized_count": 2, "truncated_count": 1, "externalized_chars": 4000},
        token_economy={"compressed_messages": 3, "compressed_chars_saved": 1200},
    )

    assert record["thread_id"] == "thread-roi"
    assert record["stable_prompt_fingerprint"] == report.stable_prompt_fingerprint
    assert record["tool_catalog_fingerprint"] == report.tool_catalog_fingerprint
    assert record["immutable_prefix_fingerprint"] == report.immutable_prefix_fingerprint
    assert record["full_tool_count"] == 2
    assert record["visible_tool_count"] == 1
    assert record["hidden_tool_count"] == 1
    assert record["provider_usage"] == {"input_tokens": 100, "output_tokens": 25, "total_tokens": 125}
    assert record["tool_output"] == {"externalized_count": 2, "truncated_count": 1, "externalized_chars": 4000}
    assert record["token_economy"] == {"compressed_messages": 3, "compressed_chars_saved": 1200}

    telemetry_path = home / ".oclaw-coding" / "thread-roi" / "roi_telemetry.jsonl"
    assert telemetry_path.is_file()
    assert [json.loads(line) for line in telemetry_path.read_text(encoding="utf-8").splitlines()] == [record]

    session_payload = json.loads((home / ".oclaw-coding" / "thread-roi" / "session.json").read_text(encoding="utf-8"))
    assert session_payload["roi"]["provider_usage"]["total_tokens"] == 125

    events = store.store.list_events("thread-roi", event_types=["roi_reported"])
    assert len(events) == 1
    assert events[0]["payload"]["hidden_tool_count"] == 1
    assert events[0]["payload"]["provider_usage"]["total_tokens"] == 125


def test_qiongqi_roi_telemetry_lists_latest_and_summarizes_totals(tmp_path, monkeypatch):
    from kkoclaw.coding_core.roi_telemetry import QiongqiRoiTelemetryStore

    home = tmp_path / "home"
    monkeypatch.setenv("HOME", str(home))

    store = QiongqiRoiTelemetryStore.from_home()
    store.record_report(
        "thread-roi",
        report={
            "stable_prompt_fingerprint": "stable-a",
            "tool_catalog_fingerprint": "tools-a",
            "immutable_prefix_fingerprint": "prefix-a",
            "full_tool_count": 3,
            "visible_tool_count": 2,
            "hidden_tool_count": 1,
        },
        provider_usage={"input_tokens": 100, "output_tokens": 50, "total_tokens": 150},
        tool_output={"externalized_count": 1, "truncated_count": 0, "externalized_chars": 2000},
        token_economy={"compressed_messages": 2, "compressed_chars_saved": 800},
    )
    second = store.record_report(
        "thread-roi",
        report={
            "stable_prompt_fingerprint": "stable-b",
            "tool_catalog_fingerprint": "tools-b",
            "immutable_prefix_fingerprint": "prefix-b",
            "full_tool_count": 4,
            "visible_tool_count": 4,
            "hidden_tool_count": 0,
        },
        provider_usage={"input_tokens": 30, "output_tokens": 20, "total_tokens": 50},
        tool_output={"externalized_count": 0, "truncated_count": 1, "externalized_chars": 0},
        token_economy={"compressed_messages": 1, "compressed_chars_saved": 200},
    )

    telemetry = store.list_reports("thread-roi")
    assert [item["seq"] for item in telemetry] == [1, 2]
    assert store.latest_report("thread-roi") == second
    assert store.summary("thread-roi") == {
        "thread_id": "thread-roi",
        "report_count": 2,
        "latest": second,
        "provider_usage": {"input_tokens": 130, "output_tokens": 70, "total_tokens": 200},
        "tool_output": {"externalized_count": 1, "truncated_count": 1, "externalized_chars": 2000},
        "token_economy": {"compressed_messages": 3, "compressed_chars_saved": 1000},
        "derived": {
            "actual_tokens": 200,
            "estimated_saved_tokens": 1000,
            "estimated_baseline_tokens": 1200,
            "saving_ratio": 0.8333333333333334,
            "tool_hidden_ratio": 0.14285714285714285,
            "tool_catalog_saved_tokens": 250,
            "tool_output_saved_tokens": 500,
            "token_economy_saved_tokens": 250,
        },
    }


def test_qiongqi_engine_persists_roi_telemetry(tmp_path, monkeypatch):
    from kkoclaw.coding_core.qiongqi import QiongqiEngine
    from kkoclaw.coding_core.roi_telemetry import QiongqiRoiTelemetryStore

    home = tmp_path / "home"
    project = tmp_path / "project"
    project.mkdir()
    monkeypatch.setenv("HOME", str(home))

    engine = QiongqiEngine.from_runtime(project_root=str(project), thread_id="thread-roi")
    report = engine.build_roi_report(stable_prompt="stable", tools=[{"name": "read_file_lines"}])

    record = engine.persist_roi_telemetry(
        store=QiongqiRoiTelemetryStore.from_home(),
        report=report,
        provider_usage={"input_tokens": 1, "output_tokens": 2, "total_tokens": 3},
    )

    assert record["thread_id"] == "thread-roi"
    assert record["provider_usage"]["total_tokens"] == 3


def test_qiongqi_roi_middleware_persists_latest_model_usage(tmp_path, monkeypatch):
    from langchain_core.messages import AIMessage

    from kkoclaw.agents.coding_agent.roi_middleware import QiongqiRoiTelemetryMiddleware
    from kkoclaw.coding_core.qiongqi import QiongqiEngine
    from kkoclaw.coding_core.roi_telemetry import QiongqiRoiTelemetryStore

    home = tmp_path / "home"
    project = tmp_path / "project"
    project.mkdir()
    monkeypatch.setenv("HOME", str(home))

    engine = QiongqiEngine.from_runtime(project_root=str(project), thread_id="thread-roi")
    report = engine.build_roi_report(stable_prompt="stable", tools=[{"name": "read_file_lines"}])
    middleware = QiongqiRoiTelemetryMiddleware(engine, report=engine.roi_metadata(report))
    state = {
        "messages": [
            AIMessage(
                content="done",
                usage_metadata={"input_tokens": 8, "output_tokens": 5, "total_tokens": 13},
            )
        ]
    }

    assert middleware.after_model(state, runtime=None) is None

    summary = QiongqiRoiTelemetryStore.from_home().summary("thread-roi")
    assert summary["report_count"] == 1
    assert summary["provider_usage"]["total_tokens"] == 13


def test_coding_roi_gateway_service_and_router_expose_telemetry(tmp_path, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from app.gateway.coding_roi_services import CodingRoiService
    from app.gateway.routers import coding_roi
    from kkoclaw.coding_core.roi_telemetry import QiongqiRoiTelemetryStore

    home = tmp_path / "home"
    monkeypatch.setenv("HOME", str(home))

    store = QiongqiRoiTelemetryStore.from_home()
    store.record_report(
        "thread-roi",
        report={
            "stable_prompt_fingerprint": "stable",
            "tool_catalog_fingerprint": "tools",
            "immutable_prefix_fingerprint": "prefix",
            "full_tool_count": 2,
            "visible_tool_count": 1,
            "hidden_tool_count": 1,
        },
        provider_usage={"input_tokens": 10, "output_tokens": 5, "total_tokens": 15},
    )

    service_response = CodingRoiService.get_summary("thread-roi")
    assert service_response["thread_id"] == "thread-roi"
    assert service_response["summary"]["provider_usage"]["total_tokens"] == 15

    app = FastAPI()
    app.include_router(coding_roi.router)

    with TestClient(app) as client:
        list_response = client.get("/api/coding/sessions/thread-roi/roi")
        summary_response = client.get("/api/coding/sessions/thread-roi/roi/summary")

    assert list_response.status_code == 200
    assert list_response.json()["reports"][0]["stable_prompt_fingerprint"] == "stable"
    assert summary_response.status_code == 200
    assert summary_response.json()["summary"]["provider_usage"]["total_tokens"] == 15
