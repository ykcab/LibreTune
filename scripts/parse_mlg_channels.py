"""Extract channel names from a TunerStudio / MegaLogViewer .mlg (MLVLG) log."""

from __future__ import annotations

import struct
import sys
from pathlib import Path

FIELD_SIZE_V2 = 89
FIELD_SIZE_V1 = 55


def cstring(buf: bytes) -> str:
    z = buf.find(b"\x00")
    if z < 0:
        z = len(buf)
    return buf[:z].decode("latin-1", errors="replace").strip()


def parse_mlg(path: Path) -> list[dict]:
    data = path.read_bytes()
    if data[:5] != b"MLVLG":
        raise ValueError(f"Not MLVLG: {data[:5]!r}")

    # Header (big-endian numerics per MLG / rusEFI docs)
    # 0:6  magic+pad
    # 6:2  version
    # 8:4  unix time
    # 12:4 info start
    # 16:4 data begin
    # 20:2 record length
    # 22:2 num fields
    version = struct.unpack_from(">H", data, 6)[0]
    unix_time = struct.unpack_from(">I", data, 8)[0]
    info_start = struct.unpack_from(">I", data, 12)[0]
    data_begin = struct.unpack_from(">I", data, 16)[0]
    record_len = struct.unpack_from(">H", data, 20)[0]
    num_fields = struct.unpack_from(">H", data, 22)[0]

    field_size = FIELD_SIZE_V2 if version >= 2 else FIELD_SIZE_V1
    print(
        f"version={version} fields={num_fields} record_len={record_len} "
        f"data_begin={data_begin} info_start={info_start} unix={unix_time} "
        f"field_size={field_size}"
    )

    fields: list[dict] = []
    pos = 24
    for i in range(num_fields):
        chunk = data[pos : pos + field_size]
        if len(chunk) < field_size:
            print(f"truncated field table at {i}")
            break
        ftype = chunk[0]
        name = cstring(chunk[1:35])
        units = cstring(chunk[35:45])
        category = ""
        if field_size >= 89:
            category = cstring(chunk[55:89])
        fields.append(
            {
                "index": i,
                "type": ftype,
                "name": name,
                "units": units,
                "category": category,
            }
        )
        pos += field_size

    return fields


def main() -> int:
    path = Path(
        sys.argv[1]
        if len(sys.argv) > 1
        else r"C:\Users\Alain\Documents\dev\epicefi_fw\temp_papers\log3.mlg"
    )
    fields = parse_mlg(path)
    print(f"\n=== {len(fields)} channels ===\n")
    for f in fields:
        extra = []
        if f["units"]:
            extra.append(f["units"])
        if f["category"]:
            extra.append(f"cat={f['category']}")
        suffix = f"  ({', '.join(extra)})" if extra else ""
        print(f"{f['index']:4d}  {f['name']}{suffix}")

    out = path.with_suffix(".channels.txt")
    out.write_text("\n".join(f["name"] for f in fields) + "\n", encoding="utf-8")
    print(f"\nWrote {out}")

    # Highlight the user's must-have set
    must = [
        "isCranking",
        "crankingFuel_fuel",
        "running_fuel",
        "running_baseFuel",
        "running_postCrankingFuelCorrection",
        "revolutionCounterSinceStart",
        "highFuelPressure",
        "injectorDutyCycle",
        "fuelFlowRate",
        "injectionOffset",
        "injectorState1",
        "coilState1",
        "currentVe",
        "firmwareVersion",
    ]
    names = {f["name"] for f in fields}
    print("\n=== must-have presence ===")
    for m in must:
        hits = [f["name"] for f in fields if m.lower() in f["name"].lower() or f["name"] == m]
        print(f"{'OK' if m in names else '--'}  {m}" + (f"  ~{hits[:3]}" if hits and m not in names else ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
