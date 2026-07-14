import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
COMMAND = ROOT / "scripts" / "helm-report"


class AuthoringKitTests(unittest.TestCase):
    def run_command(self, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [str(COMMAND), *args],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )

    def test_component_gallery_passes_visual_contract(self):
        result = self.run_command("check", "authoring/component-gallery.html")
        self.assertEqual(0, result.returncode, result.stdout + result.stderr)
        self.assertIn("10 component(s)", result.stdout)

    def test_new_profile_is_intentionally_unfinished(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "report.html"
            created = self.run_command(
                "new",
                "--profile",
                "benchmark",
                "--title",
                "Benchmark scaffold",
                "--id",
                "benchmark-scaffold",
                "--output",
                str(output),
            )
            self.assertEqual(0, created.returncode, created.stdout + created.stderr)
            source = output.read_text(encoding="utf-8")
            self.assertIn('"profile": "benchmark"', source)
            self.assertIn('data-helm-component="range"', source)
            checked = self.run_command("check", str(output))
            self.assertNotEqual(0, checked.returncode)
            self.assertIn("placeholder block(s) remain", checked.stdout)

    def test_component_override_drives_claim_manifest(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "report.html"
            created = self.run_command(
                "new",
                "--profile",
                "research",
                "--components",
                "hierarchy,sequence",
                "--id",
                "architecture-note",
                "--output",
                str(output),
            )
            self.assertEqual(0, created.returncode, created.stdout + created.stderr)
            source = output.read_text(encoding="utf-8")
            self.assertIn('"component": "hierarchy"', source)
            self.assertIn('"component": "sequence"', source)
            self.assertNotIn('"component": "evidence-ledger"', source)


if __name__ == "__main__":
    unittest.main()
