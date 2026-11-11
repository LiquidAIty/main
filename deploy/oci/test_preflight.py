"""Tests for literal runtime configuration and preservation in the Docker overlay."""
# Entity: Oracle Deployment
# Relationship: Verifies preflight never executes environment text and the Docker package retains external database and separate process boundaries.
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from preflight import ROOT, credential_presence, read_environment
from health import local_readiness
from patch_kronos_import import PATCHED, UPSTREAM, patch_import


class DeploymentInputs(unittest.TestCase):
    def parse(self, value):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'runtime.env'
            path.write_text(value, encoding='utf-8')
            return read_environment(path)

    def test_environment_is_literal_and_duplicate_keys_fail(self):
        self.assertEqual(self.parse("KEY='$(touch never)'\nOTHER=literal\n"),
                         {'KEY': '$(touch never)', 'OTHER': 'literal'})
        with self.assertRaisesRegex(ValueError, 'duplicate'):
            self.parse('KEY=first\nKEY=second')
        with self.assertRaisesRegex(ValueError, 'env_line_invalid'):
            self.parse('echo should-never-run')
        with self.assertRaisesRegex(ValueError, 'env_expansion_not_literal'):
            self.parse('KEY=$UNEXPECTED_EXPANSION')

    def test_root_authority_is_not_copied_into_application_overlay(self):
        overlay = (ROOT / 'deploy/oci/compose.docker.yml').read_text(encoding='utf-8')
        services = overlay.split('\nservices:\n', 1)[1].split('\nvolumes:\n', 1)[0]
        self.assertNotIn('\n  postgres:\n', services)
        self.assertNotIn('\n  neo4j:\n', services)
        self.assertEqual(overlay.count('external: true'), 3)
        self.assertNotIn('\n    ports:', services)
        self.assertIn('create_host_path: false', services)

    def test_source_context_excludes_private_runtime_state(self):
        ignored = (ROOT / '.dockerignore').read_text(encoding='utf-8').splitlines()
        for rule in ('**/.env', '**/.hermes', '**/.ssh', '**/*.db', '**/*.sqlite',
                     '**/uploads', '**/.gev-cache', '**/workspace.local.json', 'apps/backend/env',
                     'apps/backend/.data'):
            self.assertIn(rule, ignored)
        self.assertNotIn('!agent-products/**', ignored)

    def test_model_keys_reach_hermes_without_selecting_saved_models(self):
        overlay = (ROOT / 'deploy/oci/compose.docker.yml').read_text(encoding='utf-8')
        hermes = overlay.split('\n  hermes:\n', 1)[1].split('\n  worldview:\n', 1)[0]
        for key in ('OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'FIRECRAWL_API_KEY'):
            self.assertIn(key + ': ${' + key + ':-}', hermes)
        self.assertNotIn('HERMES_MODEL', hermes)
        self.assertTrue(credential_presence('openrouter', {'OPENROUTER_API_KEY': 'fixture'}).startswith('PRESENT'))
        self.assertTrue(credential_presence('openai-api', {}).startswith('MISSING'))
        self.assertTrue(credential_presence('openai-codex', {'OPENAI_API_KEY': 'fixture'}).startswith('UNPROVEN'))

    def test_health_requires_auth_catalog_and_installed_providers_not_only_http_200(self):
        with patch('health.read', return_value=(200, {'ok': True})):
            results = dict((name, ok) for name, ok, _ in local_readiness())
        self.assertFalse(results['hermes-webapp'])
        self.assertFalse(results['mcp-catalog'])
        self.assertFalse(results['worldview-provider'])
        fixtures = [(200, {'status': 'ok'})] * 3 + [
            (200, {'ok': True, 'catalogReady': True}),
            (200, {'ok': True, 'auth_required': True}),
            (200, {'ok': True, 'service': 'worldview', 'providers': ['celestrak-proxy', 'rocket-launches-proxy']}),
        ]
        with patch('health.read', side_effect=fixtures):
            self.assertTrue(all(ok for _, ok, _ in local_readiness()))

    def test_kronos_patch_accepts_upstream_and_current_without_changing_math(self):
        body = '\nclass Model:\n    unchanged_math = 1 + 2\n'
        self.assertEqual(patch_import(UPSTREAM + body), PATCHED + body)
        self.assertEqual(patch_import(PATCHED + body), PATCHED + body)
        current = (ROOT / 'agent-products/kronos/model/kronos.py').read_text(encoding='utf-8')
        expected = PATCHED + current[len(UPSTREAM):] if current.startswith(UPSTREAM) else current
        self.assertEqual(patch_import(current), expected)
        with self.assertRaisesRegex(ValueError, 'Unexpected Kronos'):
            patch_import(UPSTREAM.replace('from model.module import *', 'from unknown import *') + body)


if __name__ == '__main__':
    unittest.main()
