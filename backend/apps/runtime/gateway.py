"""Render an inert CGI package; never register an application or write a document root."""
from pathlib import Path
import os
import re
import stat


def render(output, *, backend='/home/bazartej/apps/bazar/current/backend', uid=1394, host='api.bazartejaratrezayi.com'):
    output = Path(output)
    if not re.fullmatch(r'/[A-Za-z0-9_./-]+', backend) or '..' in Path(backend).parts or not re.fullmatch(r'[a-z0-9.-]+', host) or uid < 1:
        raise ValueError('Explicit reviewed absolute backend path, UID and hostname required.')
    output.mkdir(mode=0o700)
    if output.is_symlink() or output.stat().st_uid != os.getuid() or stat.S_IMODE(output.stat().st_mode) & 0o077:
        raise ValueError('Package output must be newly created and privately owned.')
    script = f'''#!{backend}/.venv/bin/python
# Public executable contains paths only. All source/settings/data stay private.
import os
import sys
from pathlib import Path
if os.getuid() != {uid}:
    raise RuntimeError("CGI must execute as the owning account; never loosen private permissions.")
root = Path({backend!r}).resolve(strict=True)
if root.stat().st_uid != {uid} or root.stat().st_mode & 0o022:
    raise RuntimeError("Untrusted backend ownership or permissions.")
os.environ.pop("HTTP_PROXY", None)
os.environ["PATH"] = str(root / ".venv/bin") + os.pathsep + "/usr/local/bin:/usr/bin:/bin"
os.environ["DJANGO_SETTINGS_MODULE"] = "config.settings.production"
os.chdir(root)
sys.path.insert(0, str(root))
from config.cgi import main
main()
'''
    rules = f'''# Candidate API root only. Requires later inactive-host acceptance.
Options +ExecCGI -Indexes
DirectoryIndex disabled
AcceptPathInfo On
CGIPassAuth On
<IfModule passenger_module>
    PassengerEnabled off
</IfModule>
<Files "bazar.cgi">
    SetHandler cgi-script
</Files>
RewriteEngine On
RewriteCond %{{HTTP_HOST}} !^{re.escape(host)}(?::443)?$ [NC]
RewriteRule ^ - [R=404,END]
RewriteCond %{{HTTPS}} !=on
RewriteRule ^ https://{host}%{{REQUEST_URI}} [R=308,END]
RewriteRule ^static/ - [END]
RewriteRule ^bazar\\.cgi(?:/|$) - [END]
RewriteRule ^(.*)$ bazar.cgi/$1 [END,QSA]
'''
    for name, value, mode in [('bazar.cgi', script, 0o700), ('.htaccess', rules, 0o644)]:
        with os.fdopen(os.open(output / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode), 'w') as stream:
            stream.write(value)
    return output
