"""Re-pull Funky's chemistry data and rebuild docs/index.html.
Usage (from the tools/ folder):  FUNKY=/path/to/funky-station-clone python3 sync.py
In practice you never run this by hand: the 'Sync Funky data' GitHub Action does it."""
import subprocess, sys, os
for step in ('parse.py', 'sources.py', 'build_data.py', 'guidebook.py', 'build.py'):
    print('==', step, flush=True)
    subprocess.check_call([sys.executable, step])
