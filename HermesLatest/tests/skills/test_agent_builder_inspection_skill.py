"""The Builder skill ships through Hermes's supported bundled-skill sync."""

from pathlib import Path

from tools import skills_sync


def test_agent_builder_inspection_is_seeded_into_a_fresh_profile(
    tmp_path: Path,
    monkeypatch,
) -> None:
    home = tmp_path / ".hermes"
    skills_dir = home / "skills"
    monkeypatch.setenv("HERMES_HOME", str(home))
    monkeypatch.setattr(skills_sync, "HERMES_HOME", home)
    monkeypatch.setattr(skills_sync, "SKILLS_DIR", skills_dir)
    monkeypatch.setattr(
        skills_sync,
        "MANIFEST_FILE",
        skills_dir / ".bundled_manifest",
    )

    result = skills_sync.sync_skills(quiet=True)

    assert "agent-builder-inspection" in result["copied"]
    assert (
        skills_dir
        / "autonomous-ai-agents"
        / "agent-builder-inspection"
        / "SKILL.md"
    ).is_file()
