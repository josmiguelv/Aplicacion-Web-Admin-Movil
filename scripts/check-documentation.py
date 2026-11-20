#!/usr/bin/env python3
"""Fail if API/config changes omit their authoritative Markdown documentation."""
from __future__ import annotations
import argparse
import subprocess
import sys

RULES = (
    (("server/mobile-tuverso-routes.mjs", "server/mobile-tuverso-routes.test.mjs"), "docs/MOBILE_TUVERSO_APIS_SEPARADAS.md"),
    (("server/mobile-order-availability.mjs", "server/mobile-order-availability.test.mjs"), "docs/MOBILE_ORDER_AVAILABILITY_API.md"),
    (("server/tuverso-client.mjs", "server/tuverso-mobile-connector.mjs", "server/integrations.mjs", "src/app/TuVersoIntegrations.tsx"), "docs/TUVERSO_INTEGRACIONES.md"),
    (("server/service-api-keys.mjs",), "docs/API_KEYS_INTEGRACIONES.md"),
    (("server/schema.sql", "server/migrations/"), "docs/ARQUITECTURA_ADMINISTRADOR_SAAS.md"),
    (("server/index.mjs", "src/app/MobileOperations.tsx", "src/app/AdminPortal.tsx"), "docs/MAPA_COMPONENTES_Y_RIESGOS.md"),
)
# A documented API change must update the corresponding API contract, not only an index.
API_ENTRYPOINTS = {
    "server/index.mjs",
    "server/mobile-tuverso-routes.mjs",
    "server/mobile-order-availability.mjs",
    "server/tuverso-client.mjs",
    "server/tuverso-mobile-connector.mjs",
    "server/integrations.mjs",
    "server/service-api-keys.mjs",
}
API_DOCS = {
    "docs/MOBILE_TUVERSO_APIS_SEPARADAS.md",
    "docs/MOBILE_ORDER_AVAILABILITY_API.md",
    "docs/TUVERSO_INTEGRACIONES.md",
    "docs/API_KEYS_INTEGRACIONES.md",
}

def changed_files(base: str) -> list[str]:
    completed = subprocess.run(
        ["git", "diff", "--name-only", "--diff-filter=ACMR", f"{base}...HEAD"],
        text=True, capture_output=True, check=True
    )
    return [line.strip() for line in completed.stdout.splitlines() if line.strip()]

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", required=True, help="Git base ref or SHA")
    args = parser.parse_args()
    changed = set(changed_files(args.base))
    if not changed:
        print("PASS documentation: no changes")
        return 0
    violations = []
    for patterns, doc in RULES:
        affected = sorted(path for path in changed if any(
            path == p or (p.endswith("/") and path.startswith(p)) for p in patterns
        ))
        if affected and doc not in changed:
            violations.append(f"{', '.join(affected)} => update {doc}")
    if API_ENTRYPOINTS & changed and not (API_DOCS & changed):
        violations.append("Backend API modified => update at least one authoritative API contract in docs/")
    if violations:
        print("FAIL: This push/PR modifies documented APIs or configuration without updating their documentation.")
        for violation in dict.fromkeys(violations):
            print(" -", violation)
        print("Document the actual change in the same push/PR. No bypass by modifying README only.")
        return 1
    print("PASS: documentation accompanies affected API/config changes")
    return 0

if __name__ == "__main__":
    sys.exit(main())
