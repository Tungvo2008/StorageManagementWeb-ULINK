"""Private shipping package with a narrowly scoped pure-Python PDF dependency."""
import importlib.util,sys
from pathlib import Path
if importlib.util.find_spec('pypdf') is None:
    sys.path.insert(0,str(Path(__file__).parent/'vendor'))
