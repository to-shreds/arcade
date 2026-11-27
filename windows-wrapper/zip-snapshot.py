from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

wrapper = Path(__file__).resolve().parent
output = wrapper / "out"
staging = output / "child-snapshot"
snapshot = output / "child-snapshot.zip"
temporary = snapshot.with_suffix(".tmp")
if not (staging / "child-snapshot.json").is_file():
    raise SystemExit("Run prepare-snapshot.mjs before packaging.")

try:
    with ZipFile(temporary, "w") as bundle:
        for file in sorted(path for path in staging.rglob("*") if path.is_file()):
            entry = ZipInfo(file.relative_to(staging).as_posix())
            bundle.writestr(entry, file.read_bytes(), compress_type=ZIP_DEFLATED)
    temporary.replace(snapshot)
finally:
    temporary.unlink(missing_ok=True)
