import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from helm_bridge import validate_hdoc


ROOT = Path(__file__).resolve().parents[1]
TEMPLATES = (
    "research-dossier.html",
    "decision-brief.html",
    "reference-note.html",
    "agent-handoff.html",
)


class TemplateContractTests(unittest.TestCase):
    def test_shipped_templates_are_valid_hdoc_documents(self):
        for name in TEMPLATES:
            with self.subTest(template=name):
                html = (ROOT / "templates" / name).read_text(encoding="utf-8")
                manifest, _ = validate_hdoc(html)
                self.assertEqual(manifest["schema_version"], "HDOC/1.0")
                self.assertTrue(manifest["id"])
                self.assertTrue(manifest["project"]["id"])
                self.assertTrue(manifest["presentation"]["profile"])
                self.assertTrue(manifest["presentation"]["claims"])
                self.assertIn("<main data-document-root>", html)
                self.assertEqual(html.lower().count("<h1"), 1)
                self.assertIn("data-helm-component=", html)


if __name__ == "__main__":
    unittest.main()
