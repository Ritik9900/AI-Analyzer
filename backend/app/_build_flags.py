"""Build-time switches.

The packaging script (packaging/build.ps1) rewrites this file in a STAGING COPY before compiling the
backend to native code. The values below are the development defaults: no licence enforcement.
"""

REQUIRE_LICENSE = False
# "YYYY-MM-DD": every copy of this build stops working after this date, whatever its licence says.
BUILD_HARD_EXPIRY: str | None = None
BUILD_VERSION = "dev"
