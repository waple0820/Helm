# Helm

<p align="center">
  <img src="assets/helm-mark.png" width="96" height="96" alt="Helm logo" />
</p>

**A local-first artifact repository for work produced by AI agents.**

Helm turns finished HTML reports, briefs, dashboards, and research into durable project artifacts: searchable, inspectable, reviewable, and shareable without surrendering the original file.

![Helm library showing project navigation, agent-authored reports, document inspection, and intranet sharing](assets/helm-library.jpg)

## Start Helm

```bash
git clone <this-repository>
cd html-displayer

# Serve the library and its read-only share links.
python3 helm_share_server.py --host 127.0.0.1 --port 4173
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173). On the same machine, prepare the local Agent inbox once:

```bash
scripts/helm-agent-bootstrap --agent-name codex
```

## Agent quick path

`AGENTS.md` is the entry point. A compatible agent entering this repository should read it automatically; otherwise tell the agent:

> Read `AGENTS.md` and follow the Helm artifact handoff instructions. Produce one final, self-contained `HDOC/1.0` HTML artifact, validate it locally, and submit it exactly once.

From the project that produced the report, the final handoff is:

```bash
/path/to/html-displayer/scripts/helm-submit output.html --source "your-agent-name"
```

Helm derives the project identity from that working directory. The artifact then appears in **Agent inbox** for explicit review and import; the agent never receives direct access to the owner's browser library.

For the contract and ready-to-use report patterns, see [`AI-GUIDE.md`](AI-GUIDE.md) and [`templates/`](templates/).
