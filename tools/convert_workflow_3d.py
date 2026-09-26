"""Create a separate 3D-edition copy of a UI or API workflow."""
import argparse
import json
from pathlib import Path

NODE_IDS = {
    "FisherPoseStudio": "Fisher3DPoseStudio",
    "FisherQwenPose": "Fisher3DQwenPose",
    "FisherQwenFreePose": "Fisher3DQwenFreePose",
    "FisherQwen21GGUFCLIP": "Fisher3DQwen21GGUFCLIP",
}


def convert(value):
    if isinstance(value, dict):
        return {key: NODE_IDS.get(item, item) if key in ("type", "class_type", "Node name for S&R") and isinstance(item, str)
                else convert(item) for key, item in value.items()}
    if isinstance(value, list):
        return [convert(item) for item in value]
    return value


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    data = json.loads(args.source.read_text(encoding="utf-8-sig"))
    with args.output.open("x", encoding="utf-8") as stream:
        json.dump(convert(data), stream, ensure_ascii=False, indent=2)
    print(args.output)


if __name__ == "__main__":
    main()
