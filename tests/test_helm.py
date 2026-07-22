"""Tests for the Helm CLI and HDOC contract."""

import importlib.util
import json
import tempfile
import unittest
from importlib.machinery import SourceFileLoader
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
HELM_PATH = REPO / "bin" / "helm"


def load_helm():
    loader = SourceFileLoader("helm_cli", str(HELM_PATH))
    spec = importlib.util.spec_from_loader("helm_cli", loader)
    mod = importlib.util.module_from_spec(spec)
    loader.exec_module(mod)
    return mod


helm = load_helm()


class SlugTest(unittest.TestCase):
    def test_ascii(self):
        self.assertEqual(helm.slugify("Helm Convergence Report"), "helm-convergence-report")

    def test_strips_punctuation(self):
        self.assertEqual(helm.slugify("A/B: test!!"), "a-b-test")

    def test_non_latin_fallback(self):
        s = helm.slugify("库收敛")
        self.assertTrue(s and all(c.isalnum() or c == "-" for c in s))


class ManifestTest(unittest.TestCase):
    def test_reads_inline_manifest(self):
        html = (
            '<script type="application/helm+json">'
            '{"schema":"HDOC/1.1","id":"x","title":"T","type":"report"}'
            "</script>"
        )
        m = helm.read_manifest(html)
        self.assertEqual(m["id"], "x")

    def test_missing_manifest(self):
        self.assertIsNone(helm.read_manifest("<html></html>"))


class ContractTest(unittest.TestCase):
    def test_template_scaffold_fails_on_placeholders(self):
        html = (REPO / "skill" / "template.html").read_text("utf-8")
        problems, _ = helm._contract_problems(html)
        self.assertTrue(any("placeholder" in p for p in problems))

    def test_external_script_flagged(self):
        html = (
            '<script type="application/helm+json">{"id":"x","title":"t","type":"report"}</script>'
            '<main></main><script src="https://cdn.example/x.js"></script>'
        )
        problems, _ = helm._contract_problems(html)
        self.assertTrue(any("self-contained" in p for p in problems))

    def test_clean_document_passes(self):
        html = (
            '<script type="application/helm+json">'
            '{"schema":"HDOC/1.1","id":"x","title":"T","type":"report"}</script>'
            "<main data-document-root><h1>Real</h1></main>"
        )
        problems, _ = helm._contract_problems(html)
        self.assertEqual(problems, [])


class NewIndexTest(unittest.TestCase):
    def test_new_then_index_roundtrip(self):
        with tempfile.TemporaryDirectory() as d:
            lib = Path(d)

            class Args:
                title = "Round Trip"
                id = None
                type = "decision"
                summary = "hi"
                tags = "a,b"
                source = "unit"
                library = str(lib)
                force = True

            helm.cmd_new(Args())
            art = lib / "round-trip" / "index.html"
            self.assertTrue(art.exists())
            m = helm.read_manifest(art.read_text("utf-8"))
            self.assertEqual(m["type"], "decision")
            self.assertEqual(m["tags"], ["a", "b"])

            class IdxArgs:
                library = str(lib)

            helm.cmd_index(IdxArgs())
            catalog = json.loads((lib / "catalog.json").read_text("utf-8"))
            self.assertEqual(catalog["count"], 1)
            self.assertEqual(catalog["artifacts"][0]["id"], "round-trip")


class SeedArtifactTest(unittest.TestCase):
    def test_shipped_sample_passes_contract(self):
        art = REPO / "library" / "helm-convergence" / "index.html"
        if not art.exists():
            self.skipTest("no seeded artifact")
        problems, _ = helm._contract_problems(art.read_text("utf-8"))
        self.assertEqual(problems, [])


if __name__ == "__main__":
    unittest.main()
