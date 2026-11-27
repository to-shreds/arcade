import argparse
import hashlib
import json
import shutil
import struct
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

args = argparse.ArgumentParser()
args.add_argument("--source-commit", required=True)
source_commit = args.parse_args().source_commit
if len(source_commit) not in (40, 64) or any(char not in "0123456789abcdef" for char in source_commit):
    raise SystemExit("Pass the complete lowercase source commit SHA.")

wrapper = Path(__file__).resolve().parent
output = wrapper / "out"
publish = output / "Arcade-Windows-x64"
snapshot = output / "child-snapshot.zip"
target = output / "Arcade-Windows-x64-preview.zip"
required = {
    "Arcade.exe", "Arcade.dll", "Arcade.runtimeconfig.json", "Arcade.Windows.Core.dll",
    "Microsoft.Web.WebView2.Core.dll", "Microsoft.Web.WebView2.WinForms.dll", "WebView2Loader.dll",
    "coreclr.dll", "hostfxr.dll", "hostpolicy.dll",
}
missing = [name for name in sorted(required) if not (publish / name).is_file()]
if missing:
    raise SystemExit(f"The Windows publish folder is incomplete: {', '.join(missing)}")

with (publish / "Arcade.exe").open("rb") as exe:
    header = exe.read(64)
    if header[:2] != b"MZ":
        raise SystemExit("Arcade.exe is missing its executable header.")
    exe.seek(struct.unpack_from("<I", header, 0x3C)[0])
    pe = exe.read(94)
    if pe[:6] != b"PE\x00\x00\x64\x86" or struct.unpack_from("<H", pe, 92)[0] != 2:
        raise SystemExit("Arcade.exe is not a Windows x64 GUI executable.")

files = [
    (file.relative_to(publish).as_posix(), file) for file in publish.rglob("*")
    if file.is_file() and file.suffix.lower() != ".pdb"
]
files.append(("README.md", wrapper / "README.md"))
assets = json.loads((wrapper / "Arcade.Windows" / "obj" / "project.assets.json").read_text(encoding="utf-8"))
packages = {key.partition("/")[0].lower(): key.rsplit("/", 1)[-1] for key in assets["libraries"]}
runtime = json.loads((publish / "Arcade.runtimeconfig.json").read_text(encoding="utf-8"))
for framework in runtime["runtimeOptions"]["includedFrameworks"]:
    packages[framework["name"].lower() + ".runtime.win-x64"] = framework["version"]
notices = {
    "microsoft.netcore.app.runtime.win-x64": {
        "LICENSE.TXT": "dotnet-runtime-license.txt", "THIRD-PARTY-NOTICES.TXT": "dotnet-runtime-notices.txt"
    },
    "microsoft.windowsdesktop.app.runtime.win-x64": {"LICENSE": "dotnet-desktop-license.txt"},
    "microsoft.web.webview2": {"LICENSE.txt": "webview2-license.txt", "NOTICE.txt": "webview2-notices.txt"},
}
for package_id, documents in notices.items():
    version = packages[package_id]
    for document, filename in documents.items():
        candidates = [Path(folder) / package_id / version / document for folder in assets["packageFolders"]]
        source = next((file for file in candidates if file.is_file()), None)
        if source is None:
            raise SystemExit(f"Missing redistribution notice from {package_id} {version}: {document}")
        files.append((f"licenses/{filename}", source))
files.sort()
names = {name for name, _ in files}
if len(names) != len(files) or any(
    {"webview2", "parent-settings.json", "active.lock"}.intersection(name.lower().split("/"))
    or name.startswith("Arcade.Windows.Smoke") or name.startswith("Arcade.Windows.Tests")
    for name in names
):
    raise SystemExit("The publish folder contains a duplicate or an unexpected local file.")

temporary = target.with_suffix(".tmp")
try:
    with ZipFile(temporary, "w", compression=ZIP_DEFLATED) as bundle:
        for relative, source in files:
            entry = ZipInfo(f"{publish.name}/{relative}")
            entry.compress_type = ZIP_DEFLATED
            with source.open("rb") as file, bundle.open(entry, "w") as member:
                shutil.copyfileobj(file, member, length=1024 * 1024)
    with ZipFile(temporary) as bundle:
        if bundle.testzip() is not None or set(bundle.namelist()) != {f"{publish.name}/{name}" for name in names}:
            raise SystemExit("The Windows ZIP did not pass archive verification.")
    temporary.replace(target)
finally:
    temporary.unlink(missing_ok=True)

with ZipFile(snapshot) as bundle:
    snapshot_policy = json.loads(bundle.read("child-snapshot.json"))

def sha256(file):
    with file.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()

provenance = {
    "filename": target.name,
    "bytes": target.stat().st_size,
    "sha256": sha256(target),
    "snapshot": snapshot_policy["version"],
    "snapshotSha256": sha256(snapshot),
    "activities": len(snapshot_policy["activities"]),
    "packagedFiles": len(files),
    "sourceCommit": source_commit,
}
report = json.dumps(provenance, indent=2) + "\n"
target.with_suffix(".json").write_text(report, encoding="utf-8")
print(report, end="")
