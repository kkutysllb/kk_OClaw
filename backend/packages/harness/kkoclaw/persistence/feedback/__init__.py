"""Feedback persistence — ORM and SQL repository."""

from kkoclaw.persistence.feedback.model import FeedbackRow
from kkoclaw.persistence.feedback.sql import FeedbackRepository

__all__ = ["FeedbackRepository", "FeedbackRow"]
