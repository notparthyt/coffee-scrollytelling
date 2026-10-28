from pathlib import Path
import json

root = Path(__file__).resolve().parent.parent
frames_root = root / 'Frames'
parts = ['part1', 'part2', 'part3', 'part4', 'part5']
manifest = {
    'totalFrames': 0,
    'parts': [],
    'sequence': []
}

for part in parts:
    dir_path = frames_root / part
    files = sorted(dir_path.glob('*.*'), key=lambda p: int(p.stem.split('-')[-1]) if p.stem.split('-')[-1].isdigit() else p.name)
    part_frames = [f.relative_to(root).as_posix() for f in files]
    manifest['parts'].append({
        'name': part,
        'frames': part_frames
    })
    manifest['sequence'].extend(part_frames)

manifest['totalFrames'] = len(manifest['sequence'])

output_path = root / 'js' / 'frame-manifest.js'
output_path.parent.mkdir(exist_ok=True)

content = 'export const frameManifest = ' + json.dumps(manifest, indent=2) + ';\n'
output_path.write_text(content, encoding='utf-8')
print(f'Wrote {output_path} with {manifest["totalFrames"]} frames')
