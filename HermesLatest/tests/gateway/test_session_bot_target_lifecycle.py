"""The auto-created Bot Chat target can be replaced: rename and delete spend its creation identity.

``gateway.session_bot._create_bot_chat`` mints the profile's Bot Chat when none is titled so. The
creation identity of an earlier target is immutable (a retry of it must converge, and a deleted one
must never be resurrected), so a rename or canonical delete must lead to a FRESH creation instead of
replaying the old one: retitling the renamed session back, or refusing on the retired id.
"""
from types import SimpleNamespace

import pytest
import pytest_asyncio

from gateway.session_contract import SessionActor


@pytest_asyncio.fixture
async def bot(tmp_path, monkeypatch):
    from gateway import run
    from gateway.config import GatewayConfig
    from gateway.session import SessionStore
    from gateway.session_authority import initialize_session_authority
    from hermes_state import SessionDB

    monkeypatch.setenv('HERMES_HOME', str(tmp_path))
    # A following Bot Chat reads the profile config by path.
    monkeypatch.setattr(run, '_load_gateway_config',
                        lambda *_path: {'platform_toolsets': {'cli': []}, 'model': {'default': 'fixture'}})
    store = SessionStore(tmp_path / 'sessions', GatewayConfig())
    store._db = SessionDB(db_path=tmp_path / 'state.db')
    runner = SimpleNamespace(session_store=store, _session_db=store._db, adapters={}, _draining=False,
                             _evict_cached_agent=lambda route: None)
    runner._adapter_for_source = lambda source: runner.adapters.get(source.platform)
    authority = await initialize_session_authority(runner, profile_id='default', instance_id='fixture')
    owner = SessionActor('uid:1000', 'default', frozenset({'session:create', 'session:read', 'session:submit'}), 'native')
    try:
        yield SimpleNamespace(authority=authority, owner=owner, home=tmp_path)
    finally:
        store._db.close()


async def _target_id(bot):
    from gateway.session_bot import _target
    ref, _live, _entry = await _target(bot.authority, bot.owner)
    return ref.session_id


@pytest.mark.asyncio
async def test_renamed_or_deleted_bot_chat_gets_a_fresh_replacement(bot):
    db = bot.authority.db
    first = await _target_id(bot)
    assert await _target_id(bot) == first  # converges: resolved by title, never re-created

    db.set_session_title(first, 'Planning notes')
    second = await _target_id(bot)
    assert second != first
    assert db.get_session(first)['title'] == 'Planning notes'  # the rename stands
    assert db.get_session(second)['title'] == 'Bot Chat'

    assert db.delete_session(second, sessions_dir=bot.home / 'sessions')
    bot.authority.sessions.pop(second, None)
    third = await _target_id(bot)
    assert third not in (first, second)  # a replacement, not the retired id
    assert db.get_session(second) is None
    assert db.get_session(third)['title'] == 'Bot Chat'
    assert await _target_id(bot) == third


@pytest.mark.parametrize('resets', [1, 2])
@pytest.mark.asyncio
async def test_discovered_bot_target_follows_reset_and_admits_once(bot, monkeypatch, resets):
    from gateway.session_contract import SessionRef
    from gateway.session_mutations import mutate_session
    from gateway.session_bot import deliver
    from hermes_state_runtime import RuntimeStoreError, list_session_admissions
    from tools.bot_live_delivery import find_canonical_live_owner

    authority, db = bot.authority, bot.authority.db
    authority._schedule = lambda _ref: None  # Exercise admission, not model inference.
    root = await _target_id(bot)
    owner = SessionActor(bot.owner.subject, bot.owner.profile_id,
                         bot.owner.capabilities | {'session:control'}, 'native')
    for index in range(resets):
        row = db.get_session(root)
        result = await mutate_session(authority, owner, SessionRef('default', root), dict(
            session_id=root, request_id=f'reset-{index}', expected_revision=row['runtime_revision'],
            expected_generation=row['runtime_generation'], operation='reset', payload={}))
    current = result['target_session_id']
    assert db.get_session_by_title('Bot Chat')['id'] == root
    assert db.get_compression_tip(root) == root
    assert current != root
    monkeypatch.setattr('hermes_cli.gateway_runtime.discover_gateway_endpoint',
                        lambda *_a, **_kw: SimpleNamespace(
                            state='ready', endpoint=SimpleNamespace(instance_id='fixture')))
    discovered = find_canonical_live_owner(bot.home)
    assert discovered['session_id'] == discovered['live_session_id'] == current
    connection = SimpleNamespace(authority=authority, actor=owner)
    params = dict(id='7' * 32, profile='default', session_id=current, message='One research request')
    first = await deliver(connection, params)
    again = await deliver(connection, params)
    assert again['admission_id'] == first['admission_id']
    assert len(list_session_admissions(db, session_id=root, pending_only=False)) == 1
    with pytest.raises(RuntimeStoreError, match='admission_conflict'):
        await deliver(connection, {**params, 'message': 'A different request'})
    for wrong_target in (root, 'another-conversation'):
        with pytest.raises(RuntimeStoreError, match='admission_conflict'):
            await deliver(connection, {**params, 'id': '8' * 32, 'session_id': wrong_target})
    assert len(list_session_admissions(db, session_id=root, pending_only=False)) == 1
