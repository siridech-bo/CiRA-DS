import importlib
_pyds = importlib.import_module('pyds')
for _name in dir(_pyds):
    if not _name.startswith('_'):
        globals()[_name] = getattr(_pyds, _name)
