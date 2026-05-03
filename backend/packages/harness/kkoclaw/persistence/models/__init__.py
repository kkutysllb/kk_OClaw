"""ORM model registration entry point.

Importing this module ensures all ORM models are registered with
``Base.metadata`` so Alembic autogenerate detects every table.

The actual ORM classes have moved to entity-specific subpackages:
- ``kkoclaw.persistence.thread_meta``
- ``kkoclaw.persistence.run``
- ``kkoclaw.persistence.feedback``
- ``kkoclaw.persistence.user``

``RunEventRow`` remains in ``kkoclaw.persistence.models.run_event`` because
its storage implementation lives in ``kkoclaw.runtime.events.store.db`` and
there is no matching entity directory.
"""

from kkoclaw.persistence.feedback.model import FeedbackRow
from kkoclaw.persistence.models.run_event import RunEventRow
from kkoclaw.persistence.run.model import RunRow
from kkoclaw.persistence.thread_meta.model import ThreadMetaRow
from kkoclaw.persistence.user.model import UserRow

__all__ = ["FeedbackRow", "RunEventRow", "RunRow", "ThreadMetaRow", "UserRow"]
